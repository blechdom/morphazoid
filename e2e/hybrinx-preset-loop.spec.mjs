import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { HYBRINX_FULL_PRESETS } from '../src/families/syrinx/full-presets.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { watchPageDiagnostics, pageDiagnosticMessages } from './helpers/diagnostics.mjs';
const choose = (page, id) => page.evaluate(id => document.querySelector(`[data-full-preset][data-preset-id="${id}"]`).click(), id);
const capture = (page, prefix) => page.evaluate(async prefix => (await import(`${prefix}/src/site/header-presets.js`)).captureHeaderPresetState().snapshot, prefix);
const setVolume = (page, value) => page.locator('#level').evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const expectLoop = (page, loop) => expect(page.locator('#loopButton')).toHaveAttribute('aria-pressed', String(loop));

for (const prefix of ['', '/dist-wax']) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test.describe(`${prefix || 'source'} ${viewport.width}`, () => {
      test.use({ viewport, hasTouch: viewport.width < 900 });
      test('Hybrinx Loop stays under performer control across presets, Next, arrows and dice', async ({ page, baseURL }) => {
        test.setTimeout(60000);
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        await page.goto(`${prefix}/hybrinx.html`);
        await expect(page.locator('.header-preset-controls')).toBeVisible();
        await setVolume(page, 0.12);
        for (const loop of [false, true]) {
          if ((await page.locator('#loopButton').getAttribute('aria-pressed') === 'true') !== loop) await page.locator('#loopButton').click();
          for (const preset of HYBRINX_FULL_PRESETS) {
            await choose(page, preset.id);
            expect(await capture(page, prefix)).toEqual(preset.snapshot);
            await expectLoop(page, loop);
          }
          for (let i = 0; i < HYBRINX_FULL_PRESETS.length; i++) {
            await page.locator('.header-preset-next').click();
            await expectLoop(page, loop);
          }
          await page.locator('.header-preset-picker > summary').click();
          await page.locator('[data-full-preset][data-preset-id="first-croak"]').click();
          await expectLoop(page, loop);
          const before = await capture(page, prefix);
          await page.locator('#loopButton').click();
          await expectLoop(page, !loop);
          expect(await capture(page, prefix)).toEqual(before);
          await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'first-croak');
          await page.locator('#loopButton').click();
          await page.locator('.header-preset-picker > summary').focus(); await page.keyboard.press('ArrowRight');
          await expectLoop(page, loop);
          for (let i = 0; i < 12; i++) {
            await page.locator('.header-preset-random').click();
            await expectLoop(page, loop);
            expect((await capture(page, prefix)).state).not.toHaveProperty('loop');
            await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
            await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
            await expect(page.locator('#level')).toHaveValue('0.12');
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      });
    });
  }
  test(`${prefix || 'source'} Hybrinx keeps playing through randomized call boundaries until explicitly stopped`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const options = { moduleUrl: new URL(`${prefix}/src/audio-output-manager.js`, baseURL).href };
    await page.goto(`${prefix}/hybrinx.html`);
    await expect(page.locator('.header-preset-controls')).toBeVisible();
    await choose(page, 'first-croak'); await expectLoop(page, false);
    await setVolume(page, 0.12);
    await page.locator('#loopButton').click();
    await page.locator('#audioButton').click(); await page.locator('#playButton').click();
    for (const preset of HYBRINX_FULL_PRESETS) {
      await choose(page, preset.id);
      await expectLoop(page, true);
      await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    }
    const cycles = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      // Use the real dice action and record its entire resulting scene;
      // seeded musical preservation is tested separately in the pure suite.
      await page.locator('.header-preset-random').click();
      const snapshot = await capture(page, prefix);
      const cycleMs = snapshot.gesture.durationMs / snapshot.state.gestureRate + snapshot.state.loopGapMs;
      await page.waitForTimeout(Math.ceil(cycleMs + 150));
      await expectLoop(page, true);
      await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#level')).toHaveValue('0.12');
      expect((await readAudioStatus(page, options)).connectionCount).toBe(1);
      cycles.push({ attempt, cycleMs, snapshot });
    }
    await choose(page, 'tiny-trill');
    const snapshot = await capture(page, prefix);
    const cycleMs = snapshot.gesture.durationMs / snapshot.state.gestureRate + snapshot.state.loopGapMs;
    const audible = await sampleAudioEnvelope(page, { ...options, durationMs: Math.ceil(2 * cycleMs + 250) });
    expect(audible.summary.maxPeak).toBeGreaterThan(0.001);
    expect(audible.summary.clippedSamples).toBe(0);
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await expectLoop(page, true);
    await page.locator('#playButton').click();
    await choose(page, 'velvet-coo'); await page.locator('.header-preset-random').click();
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
    await expectLoop(page, true);
    // Turning Loop off deliberately still gives a normal one-shot call.
    await page.locator('#loopButton').click(); await choose(page, 'first-croak');
    await expectLoop(page, false);
    await page.locator('#playButton').click();
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
    await page.waitForTimeout(400);
    expect((await sampleAudioEnvelope(page, { ...options, durationMs: 300 })).summary.maxPeak).toBeLessThan(0.001);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    const path = testInfo.outputPath('loop-continuity.json');
    await writeFile(path, JSON.stringify({ browser: page.context().browser().version(), prefix, cycles, audible }, null, 2));
    await testInfo.attach('loop-continuity.json', { path, contentType: 'application/json' });
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    await expect.poll(async () => (await readAudioStatus(page, options)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
