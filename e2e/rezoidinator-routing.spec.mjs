import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

const BLOCKS = ['process', 'resonance', 'reverb'];
const STAGES = ['processing', 'body', 'resynthesis', 'reverb'];
const ORDERS = [
  'process-resonance-reverb', 'process-reverb-resonance',
  'resonance-process-reverb', 'resonance-reverb-process',
  'reverb-process-resonance', 'reverb-resonance-process',
];
const read = page => page.evaluate(() => globalThis.__MORPHAZOID_RUST_RESONATOR__.getState());
const row = (page, block) => page.locator(`#signalChain > [data-stage-block="${block}"]`);
const move = (page, block, direction) => row(page, block).locator(`[data-stage-move="${direction}"]`);
const order = page => page.locator('#signalChain > [data-stage-block]').evaluateAll(rows => rows.map(row => row.dataset.stageBlock));

async function choose(page, id, value) {
  const index = await page.locator('#' + id).evaluate((select, wanted) => [...select.options].findIndex(option => option.value === wanted), value);
  expect(index, `${id} includes ${value}`).toBeGreaterThanOrEqual(0);
  await page.locator(`[data-select-id="${id}"] > summary`).click();
  await page.locator(`[data-select-id="${id}"] button[data-option-index="${index}"]`).click();
}
async function range(page, id, value) {
  await page.locator('#' + id).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function stages(page, enabled) {
  for (const stage of STAGES) if (await page.locator(`#${stage}Enabled`).isChecked() !== enabled.includes(stage)) {
    await page.locator(`label[for="${stage}Enabled"]`).click();
  }
}
async function setOrder(page, value) {
  const wanted = value.split('-');
  // Exercise the same native movement buttons that users operate. Moving each
  // desired block toward the start reaches every permutation without test APIs.
  for (const [index, block] of wanted.entries()) {
    for (let remaining = 2; (await order(page)).indexOf(block) > index && remaining > 0; remaining--) {
      await move(page, block, -1).click();
    }
  }
  expect(await order(page)).toEqual(wanted);
  expect((await read(page)).settings.stageOrder).toBe(value);
}
function path(settings) {
  const labels = {
    process: settings.processingEnabled ? 'Filter / drive' : '',
    resonance: [settings.bodyEnabled ? 'Body' : '', settings.resynthesisEnabled ? 'FFT' : ''].filter(Boolean).join(' ∥ '),
    reverb: settings.reverbEnabled ? 'Reverb' : '',
  };
  return ['Source', ...settings.stageOrder.split('-').map(block => labels[block]).filter(Boolean), 'Output'].join(' → ');
}
async function synchronized(page) {
  const state = await read(page), settings = state.settings;
  expect(ORDERS).toContain(settings.stageOrder);
  expect(await order(page)).toEqual(settings.stageOrder.split('-'));
  await expect(page.locator('#signalPath')).toHaveText(path(settings));
  for (const stage of STAGES) {
    await expect(page.locator(`#${stage}Enabled`)).toHaveAttribute('role', 'switch');
    await expect(page.locator(`#${stage}Enabled`)).toBeChecked({ checked: settings[`${stage}Enabled`] });
  }
  for (const [index, block] of settings.stageOrder.split('-').entries()) {
    if (index === 0) await expect(move(page, block, -1)).toBeDisabled();
    else await expect(move(page, block, -1)).toBeEnabled();
    if (index === 2) await expect(move(page, block, 1)).toBeDisabled();
    else await expect(move(page, block, 1)).toBeEnabled();
  }
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

test('six processing orders and every stage combination stay synchronized without arming Audio', async ({ page }) => {
  test.setTimeout(60000);
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await expect(page.locator('#useSelect')).toHaveCount(0);
  await expect(page.locator('ol#signalChain')).toHaveCount(1);
  await expect(row(page, 'resonance').locator('input[role="switch"]')).toHaveCount(2);
  expect((await synchronized(page)).settings).toMatchObject({ stageOrder: ORDERS[0], bodyEnabled: true,
    processingEnabled: false, resynthesisEnabled: false, reverbEnabled: false });
  await stages(page, STAGES);
  for (const value of ORDERS) {
    await setOrder(page, value); const state = await synchronized(page);
    expect(state).toMatchObject({ audioOn: false, audioReady: false, contextState: 'none', inputKind: 'excitation' });
  }
  for (let mask = 0; mask < 16; mask++) {
    await stages(page, STAGES.filter((_, index) => mask & 1 << index));
    await synchronized(page);
  }
  await stages(page, []); await expect(page.locator('#signalPath')).toHaveText('Source → Output');
  await choose(page, 'inputSource', 'mic'); await setOrder(page, ORDERS[0]);
  await page.locator('#pluckButton').click();
  expect(await page.evaluate(() => window.__familyInput.requests)).toBe(0);
  expect(await read(page)).toMatchObject({ audioOn: false, audioReady: false, micOn: false });
});

test('native switches and reorder buttons work by keyboard and retain focus after moving a block', async ({ page }) => {
  await page.goto('simd-resonator-rust.html');
  // Registration deliberately stays unselected until an explicit preset action.
  // Recall one before verifying that a musical edit marks it Custom.
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('data-preset-id', 'unselected');
  const processing = page.locator('#processingEnabled');
  await processing.focus(); await processing.press('Space');
  expect((await read(page)).settings.processingEnabled).toBe(true);
  await processing.press('Space'); expect((await read(page)).settings.processingEnabled).toBe(false);
  await expect(move(page, 'process', -1)).toHaveAccessibleName('Move Filter / drive earlier');
  await expect(move(page, 'resonance', 1)).toHaveAccessibleName('Move Body and FFT later');
  await expect(move(page, 'reverb', -1)).toHaveAccessibleName('Move Reverb earlier');
  await move(page, 'reverb', -1).focus(); await move(page, 'reverb', -1).press('Enter');
  expect(await order(page)).toEqual(['process', 'reverb', 'resonance']);
  await expect(move(page, 'reverb', -1)).toBeFocused();
  await move(page, 'reverb', -1).press('Space');
  expect(await order(page)).toEqual(['reverb', 'process', 'resonance']);
  await expect(move(page, 'reverb', -1)).toBeDisabled();
  await expect(move(page, 'reverb', 1)).toBeFocused();
  await synchronized(page);
  expect((await read(page)).audioOn).toBe(false);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
});

test('preset recall and dice update the ordered controls and switches as complete musical state', async ({ page }) => {
  test.setTimeout(60000);
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await range(page, 'outputLevel', .73);
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  const bank = await page.evaluate(async () => (await import('/src/instruments/simd-resonator-rust/presets.js')).PRESETS);
  for (const preset of bank) {
    await page.locator('.header-preset-next').click();
    const state = await synchronized(page);
    expect(state.settings).toEqual(preset.snapshot);
    expect(state.fullPresetId).toBe(preset.id);
    expect(state.outputLevel).toBe(.73); expect(state.inputKind).toBe('sample-file');
    expect(state.input).toMatchObject({ sampleId: 'music-arp', playing: false });
    expect(state.audioOn).toBe(false);
  }
  const randomizedOrders = new Set();
  for (let index = 0; index < 12; index++) {
    await page.locator('.header-preset-random').click(); const state = await synchronized(page);
    randomizedOrders.add(state.settings.stageOrder);
    expect(state.fullPresetId).toBeNull();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
    expect(state).toMatchObject({ audioOn: false, audioReady: false, outputLevel: .73, inputKind: 'sample-file' });
    expect(state.input).toMatchObject({ sampleId: 'music-arp', playing: false });
  }
  expect(randomizedOrders.size).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__familyInput.requests)).toBe(0);
});

test('all six orders retain the playing source, AudioContext and multichannel recording', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  await stages(page, STAGES);
  await range(page, 'bodyMix', .65); await range(page, 'fftMix', .55); await range(page, 'reverbMix', .35);
  await range(page, 'filterFrequency', 1300); await range(page, 'drive', 3);
  await range(page, 'outputLevel', .63);
  await page.locator('label[for="surroundEnabled"]').click(); await choose(page, 'surroundLayout', '4-ring');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await expect.poll(async () => (await read(page)).spatialEnabled).toBe(true);
  await installOutputProbe(page);
  await page.locator('#multitrackRecord').click();
  await expect.poll(async () => (await read(page)).recording.state).toBe('recording');
  const before = await read(page);
  for (const value of ORDERS) {
    await setOrder(page, value); await audible(page); const state = await synchronized(page);
    expect(state.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
    expect(state.input).toMatchObject({ playing: true, loop: true, sampleId: 'music-arp' });
    expect(state).toMatchObject({ audioOn: true, outputLevel: .63, contextState: 'running', recording: { state: 'recording' } });
    expect(state.surround).toMatchObject({ layoutId: '4-ring', channelCount: 4 });
    expect(state.spatialPeaks.every(value => Number.isFinite(value) && value <= .951)).toBe(true);
  }
  // Disabled stages are bypassed in their chosen position. Editing the chain
  // must not restart a source or unlock/chop an in-progress recording.
  await stages(page, []); await audible(page); await synchronized(page);
  await stages(page, STAGES); await audible(page);
  await page.locator('.header-preset-random').click();
  await synchronized(page);
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

test('changing stage order preserves one live microphone capture until Audio is turned off', async ({ page }) => {
  test.setTimeout(45000);
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'mic'); await stages(page, STAGES);
  await page.locator('#micButton').click(); await expect.poll(async () => (await read(page)).micOn).toBe(true);
  expect((await read(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await installOutputProbe(page);
  for (const value of ORDERS) {
    await setOrder(page, value); await audible(page);
    expect((await read(page)).micOn).toBe(true);
    expect(await page.evaluate(() => window.__familyInput.requests)).toBe(1);
  }
  await page.evaluate(() => globalThis.__releaseRoutingOutput()); await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).micOn).toBe(false);
  expect(await page.evaluate(() => window.__familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => Promise.all(window.__familyInput.contexts.map(context => context.close())));
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}×${viewport.height}: chain controls are reachable by touch without overlap or horizontal overflow`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL + 'simd-resonator-rust.html');
    await stages(page, STAGES);
    await setOrder(page, 'reverb-resonance-process');
    await synchronized(page);
    for (const block of BLOCKS) {
      await row(page, block).scrollIntoViewIfNeeded();
      const geometry = await row(page, block).evaluate(element => {
        const box = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
        return { row: box(element), controls: [...element.querySelectorAll('label, button')].map(box) };
      });
      expect(geometry.row.height).toBeGreaterThanOrEqual(24);
      for (const control of geometry.controls) {
        expect(control.width).toBeGreaterThanOrEqual(24); expect(control.height).toBeGreaterThanOrEqual(24);
        expect(control.x).toBeGreaterThanOrEqual(geometry.row.x - 1);
        expect(control.right).toBeLessThanOrEqual(geometry.row.right + 1);
        expect(control.y).toBeGreaterThanOrEqual(geometry.row.y - 1);
        expect(control.bottom).toBeLessThanOrEqual(geometry.row.bottom + 1);
      }
      for (let a = 0; a < geometry.controls.length; a++) for (let b = a + 1; b < geometry.controls.length; b++) {
        const left = geometry.controls[a], right = geometry.controls[b];
        const overlapX = Math.min(left.right, right.right) - Math.max(left.x, right.x);
        const overlapY = Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y);
        expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1);
      }
    }
    await move(page, 'process', -1).tap();
    expect((await read(page)).settings.stageOrder).toBe('reverb-process-resonance');
    await page.locator('label[for="bodyEnabled"]').tap();
    expect((await read(page)).settings.bodyEnabled).toBe(false);
    await synchronized(page);
    expect((await read(page)).audioOn).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator('.panel').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
    await context.close();
  });
}
