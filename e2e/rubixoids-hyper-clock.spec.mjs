import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { enforceRubixoidsOwnership } from './helpers/rubixoids-ownership.mjs';

enforceRubixoidsOwnership(test, expect);
const audioButton = page => page.locator('body > .masthead #audioButton');
const playButton = page => page.locator('.rubixoids-pane:not([hidden]) #playButton');
async function read(page) {
  return page.evaluate(async () => {
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    const { rubixoidsClock } = await import('/src/instruments/rubixoids/clock.js');
    const value = rubixoidsInstrument('4d').bridge.capture();
    const timing = value.diagnostics.clock;
    return { ...value, expectedNext: timing.next && rubixoidsClock.grid(timing.next.ordinal, { division: timing.division }) };
  });
}
async function apply(page, patch) {
  await page.evaluate(async patch => {
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    await rubixoidsInstrument('4d').bridge.applySettings(patch);
  }, patch);
}
async function expectCurrentGrid(page) {
  await expect.poll(async () => {
    const state = await read(page);
    const timing = state.diagnostics.clock;
    return timing.next?.revision === timing.revision;
  }).toBe(true);
  const state = await read(page);
  const timing = state.diagnostics.clock;
  expect(timing.next.time).toBeCloseTo(state.expectedNext.time, 7);
  expect(timing.next.beat).toBeCloseTo(state.expectedNext.beat, 7);
  expect(timing.next.duration).toBeCloseTo(state.expectedNext.duration, 7);
  expect(timing.scheduled.length).toBeLessThanOrEqual(64);
  expect(state.playing).toBe(true);
  return state;
}

test('4D silent transport and Audio transitions retain the common beat', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html?dimension=4d');
  await expect(audioButton(page)).toBeEnabled();
  await expect(audioButton(page)).toHaveAttribute('aria-pressed', 'false');
  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await read(page)).diagnostics.clock.elapsed?.position ?? -1).toBeGreaterThanOrEqual(1);
  const silent = await expectCurrentGrid(page);
  expect(silent.diagnostics.clock.source).toBe('silent');
  expect(silent.audioOn).toBe(false);
  await audioButton(page).click();
  await expect(audioButton(page)).toHaveAttribute('aria-pressed', 'true');
  const audible = await expectCurrentGrid(page);
  expect(audible.diagnostics.clock.source).toBe('audio');
  expect(audible.diagnostics.clock.owner).toBe('4d');
  expect(audible.diagnostics.clock.beat).toBeGreaterThanOrEqual(silent.diagnostics.clock.beat);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 800 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  const beforeOff = await read(page);
  await audioButton(page).click();
  await expect(audioButton(page)).toHaveAttribute('aria-pressed', 'false');
  const quiet = await expectCurrentGrid(page);
  expect(quiet.diagnostics.clock.source).toBe('silent');
  expect(quiet.diagnostics.clock.beat).toBeGreaterThanOrEqual(beforeOff.diagnostics.clock.beat);
  await expect.poll(async () => (await read(page)).diagnostics.clock.beat).toBeGreaterThan(quiet.diagnostics.clock.beat + .2);
  await info.attach('hyper-audio-clock-transitions.json', { body: JSON.stringify({ silent, audible, quiet, envelope: envelope.summary }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('4D tempo, preset and pulse edits use audio-stamped grid points despite delayed visuals', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Delay display callbacks only. The controller must recover its score cursor
  // from scheduled musical time even while the displayed playhead is behind.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      const visual = new Error().stack?.includes('scheduleVisualSequenceStep');
      return schedule(callback, Number(delay || 0) + (visual ? 600 : 0), ...args);
    };
  });
  await page.goto('/rubixoids.html?dimension=4d');
  await expect(audioButton(page)).toBeEnabled();
  await audioButton(page).click();
  await expect(audioButton(page)).toHaveAttribute('aria-pressed', 'true');
  await playButton(page).click();
  await expect.poll(async () => (await read(page)).diagnostics.clock.elapsed?.position ?? -1).toBeGreaterThanOrEqual(1);
  const before = await read(page);
  expect(before.native.currentStreamStep).toBeLessThanOrEqual(before.diagnostics.clock.elapsed.position);
  await apply(page, { tempo: 151, swing: .23 });
  let state = await expectCurrentGrid(page);
  expect(state.diagnostics.clock.tempo).toBe(151);
  expect(state.diagnostics.clock.swing).toBeCloseTo(.23);
  expect(state.diagnostics.clock.beat).toBeGreaterThanOrEqual(before.diagnostics.clock.beat);
  const rates = [];
  for (const division of [1, 2, 4, 8, 16]) {
    await apply(page, { subdivisionsPerBeat: division });
    state = await expectCurrentGrid(page);
    expect(state.diagnostics.clock.division).toBe(division);
    expect(state.settings.subdivisionsPerBeat).toBe(division);
    expect(state.audioOn).toBe(true);
    rates.push(state.diagnostics.clock);
  }
  const beforePresetBeat = state.diagnostics.clock.beat;
  const expected = await page.evaluate(async () => {
    const { HYPER_RUBIX_FULL_PRESETS } = await import('/src/instruments/rubixoids/hyper-rubix/full-presets.js');
    const preset = HYPER_RUBIX_FULL_PRESETS.find(preset => preset.id === 'single-cell-bell');
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    rubixoidsInstrument('4d').root.querySelector('[data-full-preset][data-preset-id="single-cell-bell"]').click();
    return preset.snapshot.settings;
  });
  const recalled = await expectCurrentGrid(page);
  expect(recalled.diagnostics.clock.tempo).toBe(expected.tempo);
  expect(recalled.diagnostics.clock.swing).toBe(expected.swing);
  expect(recalled.diagnostics.clock.beat).toBeGreaterThanOrEqual(beforePresetBeat);
  expect(recalled.audioOn).toBe(true);
  expect(recalled.settings.voice).toBe(expected.voice);
  expect(recalled.settings.sequenceMethod).toBe(expected.sequenceMethod);
  await info.attach('hyper-clock-edits.json', { body: JSON.stringify({ before, rates, recalled }, null, 2), contentType: 'application/json' });
  await audioButton(page).click();
  expect(errors).toEqual([]);
});
