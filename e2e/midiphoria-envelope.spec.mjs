import { expect, test } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi } from './helpers/fake-midi.mjs';

const nodeFor = (page, key) => page.locator(`#lightEnvelopeEditor [data-envelope="${key}"]`);
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
async function open(page) {
  await installFakeMidi(page);
  await page.goto('/midiphoria.html');
  await expect(nodeFor(page, 'attack')).toHaveAttribute('aria-valuenow', '0.02');
}
async function press(page, key, keyboard) {
  await nodeFor(page, key).focus(); await page.keyboard.press(keyboard);
}
async function assertSynchronized(page) {
  const { snapshot } = await capture(page);
  for (const key of ['attack', 'decay', 'sustain', 'release']) {
    const value = Number(await page.locator(`#${key}`).inputValue());
    expect(Math.abs(value - snapshot.model[key])).toBeLessThanOrEqual(.0051);
    await expect(nodeFor(page, key)).toHaveAttribute('aria-valuenow', String(Number((snapshot.model[key] * (key === 'sustain' ? 100 : 1)).toFixed(2))));
  }
}

test('light envelope pointer and keyboard edits reach live light, native fields, and preset state', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('.header-preset-next').click();
  const originalAttack = Number(await page.locator('#attack').inputValue());
  const path = page.locator('#lightEnvelopeEditor .curve-path');
  const before = await path.getAttribute('d');
  await nodeFor(page, 'attack').scrollIntoViewIfNeeded();
  const box = await nodeFor(page, 'attack').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2); await page.mouse.up();
  expect(Number(await page.locator('#attack').inputValue())).toBeGreaterThan(originalAttack);
  expect(await path.getAttribute('d')).not.toBe(before);
  await assertSynchronized(page);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');

  await press(page, 'attack', 'Home'); await press(page, 'decay', 'Home'); await press(page, 'sustain', 'End');
  await page.locator('#viewMode').selectOption('ribbons');
  await enableFakeMidi(page);
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
  await sendMidi(page, [0x90, 60, 127]);
  await expect(page.locator('#levelReadout')).toHaveText('100% light');
  await press(page, 'sustain', 'Home');
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await press(page, 'sustain', 'End');
  await expect(page.locator('#levelReadout')).toHaveText('100% light');
  await press(page, 'release', 'End'); await sendMidi(page, [0x80, 60, 0]);
  await expect(page.locator('#noteReadout')).toContainText('Releasing');
  await press(page, 'release', 'Home'); await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await assertSynchronized(page);
  expect(errors).toEqual([]);
});

test('envelope follows presets, dice, native values, reset and one restored controller', async ({ page }) => {
  await open(page);
  for (let index = 0; index < 3; index++) {
    await page.locator('.header-preset-next').click(); await assertSynchronized(page);
    await page.locator('.header-preset-random').click(); await assertSynchronized(page);
  }
  await page.locator('.midiphoria-envelope-values summary').click();
  await page.locator('#attack').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await expect(nodeFor(page, 'attack')).toHaveAttribute('aria-valuenow', '0.01');
  await expect(page.locator('#lightEnvelopeReadout')).toContainText('A 0.01 s');
  await page.locator('#aboutSetup > summary').click(); await page.locator('#resetButton').click();
  await expect(nodeFor(page, 'attack')).toHaveAttribute('aria-valuenow', '0.02');
  await expect(nodeFor(page, 'release')).toHaveAttribute('aria-valuenow', '0.45');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await press(page, 'attack', 'ArrowRight');
  await expect(page.locator('#attack')).toHaveValue('0.02');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await press(page, 'attack', 'ArrowRight');
  await expect(page.locator('#attack')).toHaveValue('0.03');
  await assertSynchronized(page);
});

for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`${name} envelope handles remain reachable and cancel an active pointer`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); await open(page);
    await page.locator('#lightEnvelopeEditor').scrollIntoViewIfNeeded();
    for (const key of ['attack', 'decay', 'sustain', 'release']) {
      await expect(nodeFor(page, key)).toBeInViewport();
      const box = await nodeFor(page, key).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(28); expect(box.height).toBeGreaterThanOrEqual(28);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const editor = page.locator('#lightEnvelopeEditor');
    const box = await nodeFor(page, 'sustain').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 30);
    expect(Number(await page.locator('#sustain').inputValue())).toBeLessThan(.8);
    await editor.dispatchEvent('pointercancel', { pointerId: 1 });
    const cancelled = await page.locator('#sustain').inputValue();
    await page.mouse.move(x, y - 30); await page.mouse.up();
    await expect(page.locator('#sustain')).toHaveValue(cancelled);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#lightEnvelope').screenshot({ path: testInfo.outputPath(`${name}-envelope.png`) });
  });
}
