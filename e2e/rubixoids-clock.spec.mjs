import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { enforceRubixoidsOwnership } from './helpers/rubixoids-ownership.mjs';

enforceRubixoidsOwnership(test, expect);
const snapshot = page => page.evaluate(() => window.__rubixoidsSnapshot());
const audio = page => page.locator('body > .masthead #audioButton');
const play = page => page.locator('body > .rubixoids-bar #playButton');
const setClock = async (page, id, value) => page.locator(`body > .rubixoids-bar #${id}`).evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
async function choose(page, dimension) {
  await page.locator(`.rubixoids-dimensions [data-dimension="${dimension}"]`).click();
  await expect.poll(async () => (await snapshot(page)).dimension).toBe(dimension);
  await expect(audio(page)).toBeEnabled();
}

test('one clock keeps tempo, swing and beat phase through dimension switches and pause', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html');
  await expect(audio(page)).toBeEnabled();
  await setClock(page, 'tempo', 150);
  await setClock(page, 'swing', .2);
  await audio(page).click();
  await expect(audio(page)).toHaveAttribute('aria-pressed', 'true');
  await play(page).click();
  await expect.poll(async () => (await snapshot(page)).clock.playing).toBe(true);
  await expect.poll(async () => (await snapshot(page)).clock.beat).toBeGreaterThan(.5);
  const evidence = [];
  for (const dimension of ['2d', '4d', '3d']) {
    const before = (await snapshot(page)).clock;
    await choose(page, dimension);
    const after = await snapshot(page);
    expect(after.clock.playing).toBe(true);
    expect(after.clock.source).toBe('audio');
    expect(after.clock.owner).toBe(dimension);
    expect(after.clock.tempo).toBe(150);
    expect(after.clock.swing).toBe(.2);
    expect(after.clock.beat).toBeGreaterThanOrEqual(before.beat);
    expect(after.clock.beat - before.beat).toBeCloseTo((after.clock.time - before.time) * 150 / 60, 6);
    expect(after.dimensions[dimension].settings.tempo).toBe(150);
    expect(after.dimensions[dimension].settings.swing).toBe(.2);
    for (const [id, state] of Object.entries(after.dimensions)) {
      if (id !== dimension) expect(state.diagnostics.contextState).toBe('suspended');
    }
    const envelope = await sampleAudioEnvelope(page, { durationMs: 650 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    evidence.push({ dimension, before, after: after.clock, envelope: envelope.summary });
  }
  await play(page).click();
  await expect.poll(async () => (await snapshot(page)).clock.playing).toBe(false);
  const paused = (await snapshot(page)).clock.beat;
  await choose(page, '2d');
  await page.waitForTimeout(180);
  expect((await snapshot(page)).clock.beat).toBe(paused);
  await play(page).click();
  await expect.poll(async () => (await snapshot(page)).clock.beat).toBeGreaterThan(paused + .2);
  expect(errors).toEqual([]);
  await info.attach('shared-clock-handoffs.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('shared clock retains the full tempo range and native pulse controls', async ({ page }) => {
  await page.goto('/rubixoids.html');
  await expect(audio(page)).toBeEnabled();
  for (const value of [30, 300]) {
    await setClock(page, 'tempo', value);
    for (const dimension of ['2d', '4d', '3d']) {
      await choose(page, dimension);
      const state = await snapshot(page);
      expect(state.clock.tempo).toBe(value);
      expect(state.dimensions[dimension].settings.tempo).toBe(value);
    }
  }
  await choose(page, '2d');
  await expect(page.locator('.rubixoids-pane[data-dimension="2d"] #pulseDivision')).toBeVisible();
  await expect(page.locator('.rubixoids-pane[data-dimension="2d"] #restartLoop')).toBeVisible();
  await choose(page, '4d');
  await expect(page.locator('.rubixoids-pane[data-dimension="4d"] #twistRate')).toBeVisible();
});

test('all dimensions hold their beat during audio interruption and resume promptly', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html');
  await expect(audio(page)).toBeEnabled();
  await audio(page).click();
  await expect(audio(page)).toHaveAttribute('aria-pressed', 'true');
  await play(page).click();
  await expect.poll(async () => (await snapshot(page)).clock.beat).toBeGreaterThan(.5);
  const evidence = [];
  for (const dimension of ['3d', '2d', '4d']) {
    await choose(page, dimension);
    const interruption = await page.evaluate(async () => {
      const { rubixoidsClock: clock } = await import('/src/instruments/rubixoids/clock.js');
      const context = clock.context;
      if (!context) throw new Error('Expected an attached AudioContext');
      await context.suspend();
      const suspended = { clock: clock.snapshot(), audioTime: context.currentTime };
      await new Promise(resolve => setTimeout(resolve, 500));
      const held = { clock: clock.snapshot(), audioTime: context.currentTime };
      await context.resume();
      const resumed = { clock: clock.snapshot(), audioTime: context.currentTime };
      await new Promise(resolve => setTimeout(resolve, 160));
      return { suspended, held, resumed, advanced: { clock: clock.snapshot(), audioTime: context.currentTime } };
    });
    const { suspended, held, resumed, advanced } = interruption;
    expect(held.clock.source).toBe('audio');
    expect(held.clock.playing).toBe(true);
    expect(held.clock.owner).toBe(dimension);
    expect(held.audioTime).toBe(suspended.audioTime);
    expect(held.clock.beat).toBe(suspended.clock.beat);
    expect(advanced.clock.beat - resumed.clock.beat).toBeGreaterThan(.05);
    expect(advanced.clock.beat - resumed.clock.beat).toBeCloseTo(
      (advanced.audioTime - resumed.audioTime) * advanced.clock.tempo / 60, 3);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 650 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    evidence.push({ dimension, ...interruption, envelope: envelope.summary });
  }
  expect(errors).toEqual([]);
  await info.attach('shared-clock-interruption.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
});
