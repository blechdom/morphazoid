import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const cases = ['candy-coil-delay', 'sandy-syrup-delay', 'slippery-resynthesis'];
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());

for (const id of cases) {
  test(`${id}: samples, complete presets and dice preserve armed live input`, async ({ page, baseURL }) => {
    const diagnostic = watchPageDiagnostics(page, { baseURL });
    await page.addInitScript(() => {
      window.__sampleQA = { requests: 0, starts: 0, stops: 0, contexts: [] };
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); window.__sampleQA.contexts.push(this); }
        createBufferSource() {
          const node = super.createBufferSource(), start = node.start.bind(node), stop = node.stop.bind(node);
          node.start = (...args) => { window.__sampleQA.starts++; return start(...args); };
          node.stop = (...args) => { window.__sampleQA.stops++; return stop(...args); };
          return node;
        }
      };
      navigator.mediaDevices.getUserMedia = async () => { window.__sampleQA.requests++; throw new Error('Unexpected microphone request'); };
    });
    await page.goto(`/${id}.html`);
    await expect(page.locator('.header-preset-picker summary')).toContainText('Select Preset');
    await expect(page.locator('#sampleSelect')).toHaveValue('music-plucks');
    await expect(page.locator('#samplePlay')).toBeDisabled();
    await page.locator('.header-preset-next').click();
    const first = await capture(page);
    expect(first.presetCount).toBeGreaterThanOrEqual(12);
    await page.locator('.header-preset-random').click();
    expect((await capture(page)).selectedId).toBeNull();
    expect(await page.evaluate(() => window.__sampleQA.contexts.length)).toBe(0);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('.header-preset-picker summary').click();
    await page.locator(`.header-preset-picker button[data-preset-id="${first.selectedId}"]`).click();
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#samplePlay').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    await waitForStableAudioState(page, true);
    const signal = await sampleAudioEnvelope(page, { durationMs: 800 });
    expect(signal.summary.finite).toBe(true);
    expect(signal.summary.maxRms).toBeGreaterThan(0.001);
    expect(signal.summary.clippedSamples).toBe(0);
    await page.locator('#outputLevel').evaluate(input => { input.value = '0.31'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.locator('#inputGain').evaluate(input => { input.value = '1.23'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    const sourceStarts = await page.evaluate(() => window.__sampleQA.starts);
    for (let n = 0; n < first.presetCount; n++) await page.locator('.header-preset-next').click();
    await page.locator('.header-preset-random').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#sampleSelect')).toHaveValue('music-plucks');
    await expect(page.locator('#sampleLoop')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#outputLevel')).toHaveValue('0.31');
    await expect(page.locator('#inputGain')).toHaveValue('1.23');
    expect(await page.evaluate(() => window.__sampleQA.starts)).toBe(sourceStarts);
    expect(await page.evaluate(() => window.__sampleQA.requests)).toBe(0);

    await page.locator('#sampleNext').click();
    await expect(page.locator('#sampleSelect')).toHaveValue('music-arp');
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__sampleQA.starts)).toBe(sourceStarts + 1);
    await page.locator('#sampleLoop').click();
    await expect(page.locator('#sampleLoop')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.header-preset-next').click();
    await expect(page.locator('#sampleLoop')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#sampleStop').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#samplePlay').click();
    await page.locator('#audioButton').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'false');
    await waitForStableAudioState(page, false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect.poll(() => page.evaluate(() => window.__sampleQA.contexts.every(context => context.state === 'closed'))).toBe(true);
    expect(pageDiagnosticMessages(diagnostic)).toEqual([]);
  });

  test(`${id}: local files and microphone remain explicit and independent of presets`, async ({ page }) => {
    await page.addInitScript(() => {
      window.__inputRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.__inputRequests++; throw new Error('Microphone deliberately unavailable for this test'); };
    });
    await page.goto(`/${id}.html`);
    const source = page.getByRole('combobox', { name: 'Input source', exact: true });
    await source.selectOption('file');
    await page.locator('#filePicker').setInputFiles('assets/puggler/mic-check.wav');
    await page.getByRole('button', { name: 'Activate file input', exact: true }).click();
    await expect(page.locator('#fileAudio')).toHaveJSProperty('paused', false);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#audioButton').click();
    await waitForStableAudioState(page, true);
    await page.locator('#loopFile').click();
    await page.locator('.header-preset-next').click();
    await page.locator('.header-preset-random').click();
    await expect(page.locator('#fileAudio')).toHaveJSProperty('paused', false);
    await expect(page.locator('#fileAudio')).toHaveJSProperty('loop', false);
    await expect(source).toHaveValue('file');
    await page.locator('#filePicker').setInputFiles('assets/synthesis/loops/plucked-strings.wav');
    await expect(page.locator('#fileAudio')).toHaveJSProperty('paused', false);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await source.selectOption('microphone');
    await expect(page.locator('#fileAudio')).toHaveJSProperty('paused', true);
    expect(await page.evaluate(() => window.__inputRequests)).toBe(0);
    await page.locator('.header-preset-next').click();
    await page.locator('.header-preset-random').click();
    expect(await page.evaluate(() => window.__inputRequests)).toBe(0);
    await page.getByRole('button', { name: 'Activate microphone input', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__inputRequests)).toBe(1);
    await source.selectOption('samples');
    await expect(page.locator('#sampleSelect')).toBeVisible();
    await page.locator('#samplePlay').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#audioButton').click();
    await waitForStableAudioState(page, false);
  });

  if (id !== 'slippery-resynthesis') test(`${id}: switching mono microphone to samples restores stereo input`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('morphazoid.audio-input.v1', JSON.stringify({ inputChannels: 1 }));
      const NativeWorklet = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends NativeWorklet {
        constructor(...args) { super(...args); window.__processorInput = this; }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        window.__fakeMic = { context, stream: destination.stream };
        return destination.stream;
      };
    });
    await page.goto(`/${id}.html`);
    const source = page.getByRole('combobox', { name: 'Input source', exact: true });
    await source.selectOption('microphone');
    await page.getByRole('button', { name: 'Activate microphone input', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__processorInput?.channelCount)).toBe(1);
    await expect(page.getByRole('button', { name: 'Deactivate microphone input', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await source.selectOption('samples');
    expect(await page.evaluate(() => window.__fakeMic.stream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await page.locator('#audioButton').click();
    await page.locator('#samplePlay').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => ({
      channels: window.__processorInput.channelCount,
      mode: window.__processorInput.channelCountMode,
      interpretation: window.__processorInput.channelInterpretation,
    }))).toEqual({ channels: 2, mode: 'explicit', interpretation: 'speakers' });
    await page.locator('#audioButton').click();
    await page.evaluate(() => window.__fakeMic.context.close());
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`${id}: reachable sample and preset controls at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/${id}.html`);
      await expect(page.locator('.header-preset-next')).toBeVisible();
      await page.locator('.header-preset-next').click();
      await expect(page.locator('#sampleSelect')).toBeVisible();
      await page.locator('#sampleSelect').selectOption('speech');
      await page.locator('#sampleLoop').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const selector of ['.header-preset-next', '.header-preset-random', '#sampleSelect', '#samplePlay', '#sampleStop', '#sampleLoop']) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      }
    });
  }
}
