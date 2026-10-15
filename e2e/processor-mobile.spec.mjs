import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });

const routes = ['candy-coil-delay', 'sandy-syrup-delay', 'slippery-resynthesis'];
const controls = ['#audioButton', '.header-preset-picker summary', '.header-preset-next', '.header-preset-random', '#sampleSelect', '#sampleNext', '#samplePlay', '#sampleStop', '#sampleLoop'];

async function assertTouchTarget(control) {
  await control.scrollIntoViewIfNeeded();
  const geometry = await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { control: element.id || element.className, hit: hit?.id || hit?.className,
      x: box.x, y: box.y, width: box.width, height: box.height,
      right: box.right, bottom: box.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight,
      receivesTouch: hit === element || element.contains(hit) };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(48);
  expect(geometry.height).toBeGreaterThanOrEqual(48);
  expect(geometry.x).toBeGreaterThanOrEqual(-1);
  expect(geometry.y).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.receivesTouch, JSON.stringify(geometry)).toBe(true);
}

for (const id of routes) {
  test(`${id}: native touch playback survives orientation, preset and sample changes`, async ({ page, baseURL }, testInfo) => {
    const diagnostic = watchPageDiagnostics(page, { baseURL });
    await page.addInitScript(() => {
      window.__processorMobile = { microphoneRequests: 0, starts: 0 };
      const Native = AudioContext;
      window.AudioContext = class extends Native {
        createBufferSource() {
          const source = super.createBufferSource(), start = source.start.bind(source);
          source.start = (...args) => { window.__processorMobile.starts++; return start(...args); };
          return source;
        }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        window.__processorMobile.microphoneRequests++;
        throw new Error('Sample playback must not request a microphone.');
      };
    });
    await page.goto(`/${id}.html`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.locator('#samplePlay')).toBeDisabled();
    await page.locator('#sampleSelect').selectOption('music-tabla');
    await page.locator('#audioButton').tap();
    await page.locator('#samplePlay').tap();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    await waitForStableAudioState(page, true);
    const starts = await page.evaluate(() => __processorMobile.starts);

    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 568, height: 320 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      for (const selector of controls) await assertTouchTarget(page.locator(selector));
      expect(await page.locator('.header-preset-picker summary strong').evaluate(label => label.getBoundingClientRect().width)).toBeGreaterThanOrEqual(64);
      expect(await page.locator('#sampleSelect').evaluate(select => parseFloat(getComputedStyle(select).fontSize))).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.locator('.header-preset-next').tap();
      await expect(page.locator('#sampleSelect')).toHaveValue('music-tabla');
      await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#sampleLoop')).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => __processorMobile.starts)).toBe(starts);
      const signal = await sampleAudioEnvelope(page, { durationMs: 500 });
      expect(signal.summary.finite).toBe(true);
      expect(signal.summary.maxRms).toBeGreaterThan(0.001);
      expect(signal.summary.clippedSamples).toBe(0);
      await page.locator('#sampleSelect').scrollIntoViewIfNeeded();
      await testInfo.attach(`samples-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    }

    const nextSample = await page.locator('#sampleSelect').evaluate(select => select.options[(select.selectedIndex + 1) % select.options.length].value);
    await page.locator('#sampleNext').tap();
    await expect(page.locator('#sampleSelect')).toHaveValue(nextSample);
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => __processorMobile.starts)).toBe(starts + 1);
    await page.locator('#sampleLoop').tap();
    await expect(page.locator('#sampleLoop')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#sampleStop').tap();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#audioButton').tap();
    await waitForStableAudioState(page, false);
    expect(await page.evaluate(() => __processorMobile.microphoneRequests)).toBe(0);
    expect(pageDiagnosticMessages(diagnostic)).toEqual([]);
  });
}
