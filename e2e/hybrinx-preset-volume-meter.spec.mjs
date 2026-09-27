import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { HYBRINX_FULL_PRESETS } from '../src/families/syrinx/full-presets.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { watchPageDiagnostics, pageDiagnosticMessages } from './helpers/diagnostics.mjs';

const capture = (page, prefix) => page.evaluate(async prefix =>
  (await import(`${prefix}/src/site/header-presets.js`)).captureHeaderPresetState(), prefix);
const setVolume = (page, value) => page.locator('#level').evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const choose = (page, id) => page.evaluate(id => document.querySelector(`[data-full-preset][data-preset-id="${id}"]`).click(), id);

for (const prefix of ['', '/dist-wax']) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test.describe(`${prefix || 'source'} ${viewport.width}`, () => {
      test.use({ viewport, hasTouch: viewport.width < 900 });
      test('Hybrinx: presets, next, arrows and dice leave master volume alone', async ({ page, baseURL }) => {
        test.setTimeout(60000);
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        await page.goto(`${prefix}/hybrinx.html`);
        await expect(page.locator('.header-preset-controls')).toBeVisible();
        const maximum = await page.locator('#level').getAttribute('max');
        for (const level of [0, 0.12, 0.67, Number(maximum)]) {
          await setVolume(page, level);
          for (const preset of HYBRINX_FULL_PRESETS) {
            await choose(page, preset.id);
            expect((await capture(page, prefix)).snapshot).toEqual(preset.snapshot);
            await expect(page.locator('#level')).toHaveValue(String(level));
            await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', preset.id);
          }
          await page.locator('.header-preset-next').click();
          await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', HYBRINX_FULL_PRESETS[0].id);
          await expect(page.locator('#level')).toHaveValue(String(level));
          await page.locator('.header-preset-random').click();
          await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
          expect((await capture(page, prefix)).snapshot.state).not.toHaveProperty('level');
          await expect(page.locator('#level')).toHaveValue(String(level));
          await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
          await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
        }
        // Use the visible menu and actual knob keyboard control as well as the
        // native button actions above. Volume must not invalidate preset identity.
        const first = HYBRINX_FULL_PRESETS[0];
        await page.locator('.header-preset-picker > summary').click();
        await page.locator(`[data-full-preset][data-preset-id="${first.id}"]`).click();
        const before = (await capture(page, prefix)).snapshot;
        await page.locator('#level').focus(); await page.keyboard.press('ArrowLeft');
        await expect(page.locator('#level')).not.toHaveValue(maximum);
        expect((await capture(page, prefix)).snapshot).toEqual(before);
        await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', first.id);
        const volume = await page.locator('#level').inputValue();
        await page.locator('.header-preset-picker > summary').focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', HYBRINX_FULL_PRESETS[1].id);
        await expect(page.locator('#level')).toHaveValue(volume);
        // Native host and call choices keep the performer's output too.
        await page.locator('#animalSelect').selectOption('wolf');
        await page.locator('#callSelect').selectOption({ index: 1 });
        await expect(page.locator('#level')).toHaveValue(volume);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      });
    });
  }
}

for (const prefix of ['', '/dist-wax']) {
  test(`${prefix || 'source'} Hybrinx: real stereo meters follow post-master output and preserve muted recalls`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const options = { moduleUrl: new URL(`${prefix}/src/audio-output-manager.js`, baseURL).href };
    await page.goto(`${prefix}/hybrinx.html`);
    await expect(page.locator('.header-preset-controls')).toBeVisible();
    await choose(page, 'first-croak');
    await page.locator('#loopButton').click(); // Loop is now an explicit live control.
    // Play must not arm Audio, and neither a high knob nor motion is a signal.
    await setVolume(page, 1); await page.locator('#playButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect((await readAudioStatus(page, options)).connectionCount).toBe(0);
    expect(await page.locator('.header-output-meter').evaluateAll(nodes => nodes.every(n => n.value === 0))).toBe(true);
    await page.locator('#playButton').click();
    await setVolume(page, 0.12); await page.locator('#audioButton').click();
    // A held manual breath provides a steady source, not phase-dependent call gaps.
    await page.locator('#breathButton').focus(); await page.keyboard.down('Enter');
    await expect.poll(async () => (await readAudioStatus(page, options)).peak).toBeGreaterThan(0.001);
    await expect.poll(async () => page.locator('.header-output-meter').evaluateAll(nodes => Math.min(...nodes.map(n => n.value)))).toBeGreaterThan(0.001);
    await page.waitForTimeout(300);
    const low = await sampleAudioEnvelope(page, { ...options, durationMs: 650 });
    await setVolume(page, 0.48); await page.waitForTimeout(400);
    const high = await sampleAudioEnvelope(page, { ...options, durationMs: 650 });
    expect(high.summary.meanRms).toBeGreaterThan(low.summary.meanRms * 2);
    expect(high.summary.clippedSamples).toBe(0);
    await expect(page.locator('.header-output-meter-shell')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('meters-active.png') });
    await setVolume(page, 0); await page.waitForTimeout(500);
    const muted = await sampleAudioEnvelope(page, { ...options, durationMs: 350 });
    expect(muted.summary.maxPeak).toBeLessThan(0.00001);
    expect(await page.locator('.header-output-meter').evaluateAll(nodes => nodes.every(n => n.value === 0))).toBe(true);
    await page.keyboard.up('Enter');
    await page.locator('#playButton').click();
    for (const preset of HYBRINX_FULL_PRESETS) {
      await choose(page, preset.id);
      await expect(page.locator('#level')).toHaveValue('0');
      expect((await capture(page, prefix)).snapshot).toEqual(preset.snapshot);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
      expect((await readAudioStatus(page, options)).connectionCount).toBe(1);
    }
    await page.locator('.header-preset-next').click();
    await page.locator('.header-preset-random').click();
    await expect(page.locator('#level')).toHaveValue('0');
    await page.waitForTimeout(350);
    expect((await sampleAudioEnvelope(page, { ...options, durationMs: 250 })).summary.maxPeak).toBeLessThan(0.00001);
    await choose(page, 'first-croak'); await setVolume(page, 0.48);
    if (await page.locator('#playButton').getAttribute('aria-pressed') !== 'true') await page.locator('#playButton').click();
    await expect.poll(async () => (await readAudioStatus(page, options)).peak).toBeGreaterThan(0.001);
    await page.locator('#playButton').click(); await page.waitForTimeout(600);
    expect((await sampleAudioEnvelope(page, { ...options, durationMs: 350 })).summary.maxPeak).toBeLessThan(0.001);
    const contexts = await page.evaluate(async url => [...(await import(url)).getSharedAudioOutputManager(globalThis).contexts.values()].map(r => ({ sampleRate: r.context.sampleRate, state: r.context.state })), options.moduleUrl);
    const path = testInfo.outputPath('post-master-meters.json');
    await writeFile(path, JSON.stringify({ browser: page.context().browser().version(), prefix, contexts, low, high, muted }, null, 2));
    await testInfo.attach('post-master-meters.json', { path, contentType: 'application/json' });
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    await expect.poll(async () => (await readAudioStatus(page, options)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
  for (const route of ['syrinx.html', 'syrinx-ui.html', 'tongued-beasts.html']) {
    test(`${prefix || 'source'} ${route}: shared family meter connection and teardown`, async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      const options = { moduleUrl: new URL(`${prefix}/src/audio-output-manager.js`, baseURL).href };
      await page.goto(`${prefix}/${route}`);
      await page.locator('#audioButton').click();
      await page.locator('#breathButton').focus(); await page.keyboard.down('Enter');
      await expect.poll(async () => (await readAudioStatus(page, options)).peak).toBeGreaterThan(0.001);
      await expect.poll(async () => page.locator('.header-output-meter').evaluateAll(nodes => Math.min(...nodes.map(n => n.value)))).toBeGreaterThan(0.001);
      expect((await readAudioStatus(page, options)).connectionCount).toBe(1);
      await setVolume(page, 0); await page.waitForTimeout(500);
      expect((await sampleAudioEnvelope(page, { ...options, durationMs: 250 })).summary.maxPeak).toBeLessThan(0.00001);
      await page.keyboard.up('Enter');
      await page.evaluate(() => dispatchEvent(new Event('pagehide')));
      await expect.poll(async () => (await readAudioStatus(page, options)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }
}
