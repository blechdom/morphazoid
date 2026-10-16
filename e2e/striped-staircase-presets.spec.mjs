import { expect, test } from '@playwright/test';
import { readAudioStatus, waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const voiceKeys = ['pitchSource', 'pitchMapping', 'pitchSpan', 'voiceLimit', 'stripeGate',
  'turnAmount', 'turnSpan', 'accentAmount', 'accentRate', 'forkAmount', 'forkSpan',
  'curvatureAmount', 'curvatureDrive', 'endlessAmount', 'endlessDirection'];
const diagnostics = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => diagnostics.set(page, watchPageDiagnostics(page, { baseURL })));
test.afterEach(async ({ page }, info) => {
  await page.evaluate(() => window.__staircaseStudies?.teardown());
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await info.attach('preset-browser-diagnostics.json', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages).toEqual([]);
});

async function state(page) {
  return page.evaluate(() => {
    const snapshot = window.__staircaseStudies.snapshot();
    return { ...snapshot, audioVoices: undefined };
  });
}
async function presetState(page) {
  return page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
}
async function settled(page) {
  await expect.poll(async () => {
    const s = await state(page);
    return s.ready && s.revision === s.acceptedRevision && (!s.audio || s.audioRevision === s.revision);
  }, { timeout: 20_000 }).toBe(true);
}
async function open(page) {
  await page.goto('/striped-staircase-rust.html'); await settled(page);
  await expect(page.locator('.header-preset-controls')).toHaveCount(1);
  return page.evaluate(async () => (await import('/src/instruments/striped-staircase-rust/full-presets.js')).STUDIES_FULL_PRESETS);
}
async function select(page, id) {
  const picker = page.locator('.header-preset-picker');
  if (!await picker.evaluate(node => node.open)) await picker.locator(':scope > summary').click();
  await picker.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', id);
  await settled(page);
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function expectMusicalState(page, expected) {
  const current = await state(page);
  for (const key of voiceKeys) {
    expect(Object.hasOwn(expected, key), `complete preset includes ${key}`).toBe(true);
    expect(current[key], `runtime recalls ${key}`).toEqual(expected[key]);
    if (key === 'stripeGate') await expect(page.locator(`#${key}`)).toBeChecked({ checked: expected[key] });
    else expect(Number(await page.locator(`#${key}`).inputValue()), `native control recalls ${key}`).toBe(expected[key]);
  }
  expect((await presetState(page)).snapshot).toEqual(expected);
}

test('complete presets restore every pitch, study and gate field without arming Audio', async ({ page }, info) => {
  test.setTimeout(120_000);
  const bank = await open(page);
  await select(page, bank[0].id);
  await page.locator('#showPaths').uncheck(); await page.locator('#showStripes').uncheck();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', bank[0].id);
  await page.locator('#pitchSource').selectOption('0');
  await page.locator('#pitchMapping').selectOption('2');
  for (const [key, value] of Object.entries({ pitchSpan: 5, voiceLimit: 129, turnAmount: .3, turnSpan: 2.2,
    accentAmount: .4, accentRate: 23, forkAmount: .5, forkSpan: 3.1, curvatureAmount: .6,
    curvatureDrive: 2.4, endlessAmount: .7 })) await range(page, key, value);
  await page.locator('#spiralTuning > summary').click();
  await page.locator('#endlessDirection').selectOption('1');
  await page.locator('#stripeGate').uncheck();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  const evidence = [];
  for (const preset of bank) {
    await select(page, preset.id); await expectMusicalState(page, preset.snapshot);
    const s = await state(page);
    expect(s).toMatchObject({ audio: false, playing: false, hold: false, showPaths: false, showStripes: false });
    expect(s.progress).toBeCloseTo(.175, 8); expect(s.level).toBe(.75);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    evidence.push({ id: preset.id, state: s });
  }
  await page.locator('.header-preset-next').click(); await settled(page);
  expect((await presetState(page)).selectedId).toBe(bank[0].id);
  await expectMusicalState(page, bank[0].snapshot);
  await info.attach('complete-preset-recall.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

test('preset select, Next and dice preserve live held transport, output level and display preferences', async ({ page }, info) => {
  test.setTimeout(90_000);
  const bank = await open(page);
  await range(page, 'level', .43);
  await page.locator('#holdButton').click(); await page.locator('#audioButton').click();
  await page.locator('#playButton').click(); await settled(page); await waitForAudioState(page, true);
  const focus = await page.locator('#tendrilFocus option').nth(1).getAttribute('value');
  await page.locator('#tendrilFocus').selectOption(focus);
  expect((await state(page)).focusedTendril).toBe(Number(focus));
  await page.locator('#showPaths').uncheck(); await page.locator('#showStripes').uncheck();
  const initial = await state(page), evidence = [];
  const actions = [() => select(page, bank[0].id),
    () => page.locator('.header-preset-next').click(),
    () => page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click()];
  for (const action of actions) {
    const before = await state(page); await action(); await settled(page);
    await expect.poll(async () => (await state(page)).clock).toBeGreaterThan(before.clock);
    const s = await state(page);
    expect(s).toMatchObject({ audio: true, playing: true, hold: true, level: .43,
      showPaths: false, showStripes: false, focusedTendril: null });
    expect(s.progress).toBeCloseTo(initial.progress, 8); expect(s.direction).toBe(initial.direction);
    expect(s.revision).toBeGreaterThan(before.revision);
    await expectMusicalState(page, (await presetState(page)).snapshot);
    evidence.push({ state: s, preset: await presetState(page) });
  }
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  await select(page, bank[0].id); await waitForAudioState(page, true);
  await page.locator('#playButton').click(); await waitForStableAudioState(page, false);
  const paused = await state(page); await page.locator('.header-preset-next').click(); await settled(page);
  expect(await state(page)).toMatchObject({ audio: true, playing: false, hold: true, level: .43 });
  expect((await state(page)).progress).toBeCloseTo(paused.progress, 8);
  await page.locator('#audioButton').click(); await range(page, 'level', 0);
  await page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click(); await settled(page);
  expect(await state(page)).toMatchObject({ audio: false, playing: false, hold: true, level: 0 });
  await waitForStableAudioState(page, false);
  await info.attach('live-preset-continuity.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`complete presets ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    test('preset menu, Next and dice remain reachable and retain silent startup', async ({ page }, info) => {
      test.setTimeout(60_000);
      const bank = await open(page), row = page.locator('.header-preset-controls');
      expect(await row.evaluate(node => document.querySelector('[data-instrument-preset-host]').firstElementChild === node)).toBe(true);
      for (const selector of ['.header-preset-picker > summary', '.header-preset-next', '.header-preset-random']) {
        const control = page.locator(selector); await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-2); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
        if (viewport.width !== 1440) { expect(box.height).toBeGreaterThanOrEqual(48); expect(box.width).toBeGreaterThanOrEqual(48); }
      }
      const picker = page.locator('.header-preset-picker'); await picker.locator(':scope > summary').click();
      const panel = picker.locator('.instrument-picker-panel'); await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(7); expect(bounds.y).toBeGreaterThanOrEqual(7);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7);
      await page.screenshot({ path: info.outputPath('full-preset-menu.png') });
      await picker.locator(`button[data-full-preset][data-preset-id="${bank[0].id}"]`).click(); await settled(page);
      await page.locator('.header-preset-next').click(); await settled(page);
      await page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click(); await settled(page);
      const randomized = (await presetState(page)).snapshot;
      await expectMusicalState(page, randomized);
      expect(bank.some(preset => JSON.stringify(preset.snapshot) === JSON.stringify(randomized))).toBe(false);
      expect(await state(page)).toMatchObject({ audio: false, playing: false, hold: false });
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      await select(page, bank[0].id); await expectMusicalState(page, bank[0].snapshot);
    });
  });
}
