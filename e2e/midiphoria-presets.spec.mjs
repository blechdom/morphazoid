import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { installFakeMidi, enableFakeMidi, sendMidi, fakeMidiSnapshot } from './helpers/fake-midi.mjs';

const presetModule = '/src/instruments/midiphoria/midiphoria-presets.js';
const bank = page => page.evaluate(async url => (await import(url)).MIDIPHORIA_PRESETS, presetModule);
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());

async function open(page) {
  await page.addInitScript(() => {
    window.__midiphoriaPresetContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__midiphoriaPresetContexts.push(this); }
    };
  });
  await installFakeMidi(page);
  await page.goto('/midiphoria.html');
  await expect(page.locator('.header-preset-controls')).toHaveCount(1);
  await expect(page.locator('#notePads button')).toHaveCount(24);
}
async function select(page, id) {
  await page.locator('.header-preset-picker > summary').click();
  await page.locator(`.header-preset-picker button[data-preset-id="${id}"]`).click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', id);
}
async function range(page, id, value, event = 'input') {
  await page.locator(`#${id}`).evaluate((node, input) => {
    node.value = String(input.value); node.dispatchEvent(new Event(input.event, { bubbles: true }));
  }, { value, event });
}
async function connect(page) {
  await enableFakeMidi(page);
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
}

// A sustained, original test chord is independent of third-party collection changes.
function organChord() {
  const variable = number => {
    const bytes = [number & 127];
    while ((number >>= 7)) bytes.unshift((number & 127) | 128);
    return bytes;
  };
  const notes = [48, 60, 67];
  const events = [0, 255, 81, 3, 7, 161, 32, 0, 192, 16,
    ...notes.flatMap(note => [0, 144, note, 96]),
    ...variable(96 * 80), 128, notes[0], 0,
    ...notes.slice(1).flatMap(note => [0, 128, note, 0]), 0, 255, 47, 0];
  const length = Buffer.alloc(4); length.writeUInt32BE(events.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]),
    Buffer.from('MTrk'), length, Buffer.from(events)]);
}

test('visual presets recall exactly, Next tours the bank, edits and dice become Custom without arming audio', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const presets = await bank(page);
  expect(presets.length).toBeGreaterThanOrEqual(12);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'unselected');
  for (const preset of presets) {
    await select(page, preset.id);
    expect((await capture(page)).snapshot, preset.label).toEqual(preset.snapshot);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  }
  await select(page, presets[0].id);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', presets[1].id);
  await range(page, 'glow', .43);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  const randomized = new Set();
  for (let index = 0; index < 8; index++) {
    await page.locator('.header-preset-random').click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
    const state = await capture(page);
    expect(state.selectedId).toBe(null);
    expect(presets.some(preset => JSON.stringify(preset.snapshot) === JSON.stringify(state.snapshot))).toBe(false);
    randomized.add(JSON.stringify(state.snapshot));
  }
  expect(randomized.size).toBe(8);
  expect(await page.evaluate(() => window.__midiphoriaPresetContexts.length)).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test('factory presets produce distinct Canvas pixels from the same chord at the same time', async ({ page }, testInfo) => {
  await open(page);
  const images = await page.evaluate(async url => {
    const { MIDIPHORIA_PRESETS, applyMidiphoriaPreset } = await import(url);
    const { MidiphoriaModel } = await import('/src/instruments/midiphoria/midiphoria-model.js');
    const { MidiphoriaRenderer } = await import('/src/instruments/midiphoria/midiphoria-renderer.js');
    return MIDIPHORIA_PRESETS.map(preset => {
      const canvas = document.createElement('canvas');
      canvas.getBoundingClientRect = () => ({ width: 640, height: 360 });
      const model = new MidiphoriaModel(), renderer = new MidiphoriaRenderer(canvas);
      applyMidiphoriaPreset(model, renderer, preset.snapshot, 0);
      for (const note of [48, 60, 67, 76]) model.handleMessage({
        type: 'noteOn', channel: 0, note, velocity: 104, sourceId: 'preset-pixel-test',
      }, .1);
      renderer.capture(model.sample(.1), .1);
      renderer.draw(model.sample(1.4), 1.4, model.options);
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261, minimum = 255, maximum = 0;
      for (let i = 0; i < data.length; i++) {
        hash = Math.imul(hash ^ data[i], 16777619) >>> 0;
        if (i % 4 !== 3) { minimum = Math.min(minimum, data[i]); maximum = Math.max(maximum, data[i]); }
      }
      return { id: preset.id, hash, minimum, maximum };
    });
  }, presetModule);
  // Color, geometry and envelope presets must have real, visible destinations.
  expect(new Set(images.map(image => image.hash)).size).toBe(images.length);
  for (const image of images) expect(image.maximum, image.id).toBeGreaterThan(20);
  await testInfo.attach('preset-pixel-fingerprints.json', { body: JSON.stringify(images, null, 2), contentType: 'application/json' });
});

test('preset recalls preserve held MIDI notes and input mapping', async ({ page }) => {
  await open(page); await connect(page);
  await page.locator('#channel').selectOption('3');
  await sendMidi(page, [0x93, 60, 110]);
  await expect(page.locator('#noteReadout')).toContainText('C4 · 1 held');
  for (const preset of await bank(page)) {
    await select(page, preset.id);
    await expect(page.locator('#channel')).toHaveValue('3');
    await expect(page.locator('#noteReadout')).toContainText('C4 · 1 held');
  }
  await sendMidi(page, [0x83, 60, 0]);
  await page.locator('#trigger').selectOption('mapped');
  await page.locator('#mappedType').selectOption('cc');
  await page.locator('#mappedNumber').fill('21');
  await page.locator('#mappedChannel').selectOption('3');
  await page.locator('.header-preset-random').click();
  await expect(page.locator('#trigger')).toHaveValue('mapped');
  await expect(page.locator('#mappedType')).toHaveValue('cc');
  await expect(page.locator('#mappedNumber')).toHaveValue('21');
  await expect(page.locator('#mappedChannel')).toHaveValue('3');
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(1);
});

test('preset tour and dice preserve the playing song, Audio, loop, speed and output', async ({ page }) => {
  test.setTimeout(60000);
  await open(page);
  await page.locator('#midiFile').setInputFiles({ name: 'Preset continuity.mid', mimeType: 'audio/midi', buffer: organChord() });
  const song = await page.locator('#songSelect').inputValue();
  await page.locator('#audioButton').click();
  await expect(page.locator('#playButton')).toBeEnabled({ timeout: 15000 });
  await page.locator('#loopSong').check();
  await range(page, 'playbackRate', 1.25); await range(page, 'outputLevel', .37);
  await page.locator('#playButton').click();
  const assertContinuous = async () => {
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#songSelect')).toHaveValue(song);
    await expect(page.locator('#loopSong')).toBeChecked();
    await expect(page.locator('#playbackRate')).toHaveValue('1.25');
    await expect(page.locator('#outputLevel')).toHaveValue('0.37');
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
  };
  const before = Number(await page.locator('#songPosition').inputValue());
  for (const preset of await bank(page)) { await select(page, preset.id); await assertContinuous(); }
  await page.locator('.header-preset-next').click(); await assertContinuous();
  await page.locator('.header-preset-random').click(); await assertContinuous();
  await range(page, 'trailWidth', 1.7); await assertContinuous();
  await page.locator('#viewMode').selectOption('radial');
  await page.locator('#colorSource').selectOption('channel');
  await range(page, 'fadeCurve', 2.5); await range(page, 'spin', -1.25); await range(page, 'symmetry', 7);
  const edited = (await capture(page)).snapshot.render;
  expect(edited.colorSource).toBe('channel'); expect(edited.fadeCurve).toBe(2.5);
  expect(edited.spin).toBe(-1.25); expect(edited.symmetry).toBe(7);
  for (const reflection of ['none', 'vertical', 'horizontal', 'both', 'diagonal', 'anti-diagonal', 'diagonals', 'all']) {
    await page.locator('#reflection').selectOption(reflection);
    expect((await capture(page)).snapshot.render.reflection).toBe(reflection);
    await assertContinuous();
  }
  for (const flow of ['classic', 'outward', 'inward']) {
    await page.locator('#flow').selectOption(flow);
    expect((await capture(page)).snapshot.render.flow).toBe(flow);
    await assertContinuous();
  }
  await page.locator('#viewMode').selectOption('mask');
  await expect(page.locator('#reflection')).toBeDisabled(); await expect(page.locator('#flow')).toBeDisabled();
  await page.locator('#viewMode').selectOption('radial');
  await expect(page.locator('#reflection')).toBeEnabled(); await expect(page.locator('#flow')).toBeEnabled();
  await expect(page.locator('#spinOut')).toHaveText('-1.25 rpm');
  await assertContinuous();
  const signal = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
  expect(signal.summary.finite).toBe(true);
  expect(signal.summary.maxRms).toBeGreaterThan(.001);
  expect(signal.summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(signal.summary.clippedSamples).toBe(0);
  expect(Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(before + 1);
  expect(await page.evaluate(() => window.__midiphoriaPresetContexts.length)).toBe(1);
});

test('pagehide releases the preset adapter and audio; BFCache restoration mounts one idle picker', async ({ page }) => {
  await open(page); await connect(page);
  await page.locator('#midiFile').setInputFiles({ name: 'Lifecycle.mid', mimeType: 'audio/midi', buffer: organChord() });
  await page.locator('#audioButton').click();
  await expect(page.locator('#playButton')).toBeEnabled({ timeout: 15000 });
  await page.locator('#playButton').click();
  await page.locator('.header-preset-next').click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect(await capture(page)).toBe(null);
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(await page.evaluate(() => window.__midiphoriaPresetContexts.every(context => context.state === 'closed'))).toBe(true);
  expect((await fakeMidiSnapshot(page)).inputs[0].listenerCount).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('.header-preset-controls')).toHaveCount(1);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toBeDisabled();
  await expect(page.locator('#notePads button')).toHaveCount(24);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', (await bank(page))[0].id);
  expect(await page.evaluate(() => window.__midiphoriaPresetContexts.length)).toBe(1);
});
