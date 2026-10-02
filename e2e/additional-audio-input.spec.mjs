import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const routes = ['lumber', 'slippery-resynthesis', 'gesturama'];

async function installInput(page, delayed = false) {
  await page.addInitScript(({ delayed }) => {
    window.__additionalInput = { requests: 0, tracks: [], contexts: [], releases: [] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      async getUserMedia() {
        const data = window.__additionalInput;
        data.requests++;
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const merge = context.createChannelMerger(2);
        for (const [index, frequency] of [220, 440].entries()) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = frequency; gain.gain.value = .08;
          oscillator.connect(gain); gain.connect(merge, 0, index); oscillator.start();
        }
        merge.connect(destination);
        await context.resume();
        data.contexts.push(context);
        data.tracks.push(...destination.stream.getTracks());
        if (delayed) await new Promise(resolve => data.releases.push(resolve));
        return destination.stream;
      },
      addEventListener() {}, removeEventListener() {}, async enumerateDevices() { return []; },
    } });
  }, { delayed });
}

for (const route of routes) {
  test(`${route}: mic input toggles, meters and gain work with master Audio off`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await installInput(page);
    await page.goto(`/${route}.html`);
    const strip = page.locator('.mz-audio-input-strip');
    await expect(strip).toHaveCount(1);
    const mic = strip.locator('.mz-input-toggle');
    await expect(mic).toBeEnabled();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => __additionalInput.requests)).toBe(0);
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeGreaterThan(.02);
    if (route !== 'gesturama') {
      const output = await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 40 });
      expect(output.summary.maxPeak).toBeLessThan(.00001);
    }
    const gain = strip.locator('input[type="range"]');
    await gain.evaluate(node => { node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeLessThan(.001);
    await gain.evaluate(node => { node.value = '1'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeGreaterThan(.02);
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => __additionalInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
    await page.evaluate(() => Promise.all(__additionalInput.contexts.map(context => context.close())));
  });

  test(`${route}: second mic click cancels a pending permission grant`, async ({ page }) => {
    await installInput(page, true);
    await page.goto(`/${route}.html`);
    const mic = page.locator('.mz-input-toggle');
    await mic.click();
    await expect.poll(() => page.evaluate(() => __additionalInput.requests), { timeout: 15_000 }).toBe(1);
    await expect(mic).toHaveAttribute('aria-busy', 'true');
    await mic.click();
    await expect(mic).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => __additionalInput.releases.splice(0).forEach(resolve => resolve()));
    await expect.poll(() => page.evaluate(() => __additionalInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => Promise.all(__additionalInput.contexts.map(context => context.close())));
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Additional recording input controls stay aligned and reachable at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport, hasTouch: viewport.width !== 1440 });
    const page = await context.newPage();
    try {
      for (const route of routes) {
        await page.goto(`/${route}.html`);
        const strip = page.locator('.mz-audio-input-strip');
        await strip.scrollIntoViewIfNeeded();
        const geometry = await strip.evaluate(root => {
          const targets = [root.querySelector('.mz-input-gain'), root.querySelector('.mz-input-meter'), root.querySelector('.mz-input-toggle')];
          return targets.map(node => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, center: rect.top + rect.height / 2, width: rect.width, height: rect.height,
              inViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 };
          });
        });
        expect(geometry.every(target => target.inViewport), route).toBe(true);
        expect(geometry[0].right, route).toBeLessThanOrEqual(geometry[1].left);
        expect(geometry[1].right, route).toBeLessThanOrEqual(geometry[2].left);
        expect(Math.abs(geometry[0].center - geometry[1].center), route).toBeLessThan(2);
        expect(Math.abs(geometry[0].center - geometry[2].center), route).toBeLessThan(2);
        if (viewport.width !== 1440) {
          expect(geometry[2].width, route).toBeGreaterThanOrEqual(48);
          expect(geometry[2].height, route).toBeGreaterThanOrEqual(48);
        }
      }
    } finally { await context.close(); }
  });
}

for (const [route, recordSelector] of [['lumber', '#recordButton'], ['gesturama', '#record-sample-button']]) {
  test(`${route}: recording uses the enabled mic without reopening permission`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await installInput(page);
    await page.goto(`/${route}.html`);
    const mic = page.locator('.mz-input-toggle');
    await mic.click();
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await page.locator(recordSelector).click();
    await expect(page.locator(recordSelector)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(550);
    await page.locator(recordSelector).click();
    await expect(page.locator(recordSelector)).toHaveAttribute('aria-pressed', 'false');
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => __additionalInput.requests)).toBe(1);
    if (route === 'lumber') await expect(page.locator('#durationOut')).not.toHaveText('empty');
    else await expect(page.locator('#sample-status')).toHaveText('Sample ready');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await mic.click();
    await expect.poll(() => page.evaluate(() => __additionalInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
    expect(errors).toEqual([]);
    await page.evaluate(() => Promise.all(__additionalInput.contexts.map(context => context.close())));
  });
}

test('Slippery file input plays and pauses without microphone permission', async ({ page }) => {
  await installInput(page);
  await page.goto('/slippery-resynthesis.html');
  const strip = page.locator('.mz-audio-input-strip');
  await strip.locator('select').selectOption('file');
  const samples = 48_000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48_000, 24); wav.writeUInt32LE(96_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 48_000) * 3000), 44 + i * 2);
  await page.setInputFiles('#filePicker', { name: 'input.wav', mimeType: 'audio/wav', buffer: wav });
  await strip.locator('.mz-input-toggle').click();
  await expect(strip.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => strip.locator('meter').first().evaluate(node => node.value)).toBeGreaterThan(.02);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __additionalInput.requests)).toBe(0);
  await strip.locator('.mz-input-toggle').click();
  await expect.poll(() => page.locator('#fileAudio').evaluate(node => node.paused)).toBe(true);
});

test('Lumber input gain changes the recorded loop signal', async ({ page }) => {
  await installInput(page);
  await page.goto('/lumber.html');
  const strip = page.locator('.mz-audio-input-strip');
  const gain = strip.locator('input[type="range"]');
  await strip.locator('.mz-input-toggle').click();
  await expect(strip.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  await gain.evaluate(node => { node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(150);
  await page.locator('#recordButton').click();
  await expect(page.locator('#recordButton')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(650);
  await page.locator('#recordButton').click();
  await expect(page.locator('#recordButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  const silent = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(silent.summary.maxPeak).toBeLessThan(.0001);
  await gain.evaluate(node => { node.value = '1'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(150);
  await page.locator('#ringSection > summary').click();
  await page.locator('#replaceRing').click();
  await expect(page.locator('#recordButton')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(650);
  await page.locator('#recordButton').click();
  await expect(page.locator('#recordButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 200 })).summary.maxPeak).toBeGreaterThan(.005);
  expect(await page.evaluate(() => __additionalInput.requests)).toBe(1);
  await strip.locator('.mz-input-toggle').click();
  await page.evaluate(() => Promise.all(__additionalInput.contexts.map(context => context.close())));
});

test('Gesturama input gain changes the saved sample signal', async ({ page }) => {
  await installInput(page);
  await page.addInitScript(() => {
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = async function (...args) {
      const buffer = await decode.apply(this, args);
      const data = buffer.getChannelData(0);
      window.__recordedInputRms ??= [];
      window.__recordedInputRms.push(Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length));
      return buffer;
    };
  });
  await page.goto('/gesturama.html');
  const strip = page.locator('.mz-audio-input-strip');
  await strip.locator('.mz-input-toggle').click();
  await expect(strip.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  for (const value of ['0', '1']) {
    await strip.locator('input[type="range"]').evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await page.waitForTimeout(150);
    await page.locator('#record-sample-button').click();
    await expect(page.locator('#record-sample-button')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(650);
    await page.locator('#record-sample-button').click();
    await expect(page.locator('#sample-status')).toHaveText('Sample ready');
  }
  const levels = await page.evaluate(() => __recordedInputRms);
  expect(levels).toHaveLength(2);
  expect(levels[0]).toBeLessThan(.001);
  expect(levels[1]).toBeGreaterThan(.02);
  expect(await page.evaluate(() => __additionalInput.requests)).toBe(1);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await strip.locator('.mz-input-toggle').click();
  await page.evaluate(() => Promise.all(__additionalInput.contexts.map(context => context.close())));
});
