import { expect, test } from '@playwright/test';

const readState = page => page.evaluate(() => globalThis.__MORPHAZOID_WASM_GARDEN__.getState());
async function selectPreset(page, id) {
  await page.locator('#presetControls summary').click();
  await page.locator(`#garden-preset-panel [data-preset-id="${id}"]`).click();
}
async function strikeSurface(page) {
  await page.locator('#gardenCanvas').focus();
  await page.keyboard.press('Enter');
}

async function captureOutput(page) {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination === this.context.destination && !window.__tinesAnalyser) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        window.__tinesAnalyser = analyser;
        window.__tinesMaster = this;
        connect.call(analyser, destination);
        return connect.call(this, analyser, ...args);
      }
      return connect.call(this, destination, ...args);
    };
    window.__tinesOutputPeak = () => {
      if (!window.__tinesAnalyser) return 0;
      const samples = new Float32Array(2048);
      window.__tinesAnalyser.getFloatTimeDomainData(samples);
      return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    };
  });
}

test('Volumetric Rain keeps Audio explicit, plays 2048 contacts per second, and recovers from maximum Rust detail', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await captureOutput(page);
  await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
  await expect(page.locator('h1')).toHaveText('Volumetric Rain');
  await expect(page.locator('#backend, #comparison, #benchmarkButton')).toHaveCount(0);
  await page.locator('#playButton').click();
  expect(await readState(page)).toMatchObject({ repeating: true, audioOn: false, sampleRate: null });
  await strikeSurface(page);
  expect((await readState(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readState(page)).audioOn).toBe(true);
  expect((await readState(page)).hasWasm).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeGreaterThan(0.001);
  await selectPreset(page, 'scrape');
  await page.locator('#rate').fill('2048');
  await expect.poll(async () => (await readState(page)).appliedRate).toBe(2048);
  const before = await readState(page);
  await expect.poll(async () => (await readState(page)).ticks - before.ticks).toBeGreaterThan(100);
  const fast = await readState(page);
  const measuredRate = (fast.ticks - before.ticks) / (fast.audioTime - before.audioTime);
  expect(measuredRate).toBeGreaterThan(2040); expect(measuredRate).toBeLessThan(2056);
  await page.locator('#modes').selectOption('32768');
  await expect(page.locator('#capacityHint')).toBeVisible();
  await page.locator('#baseFrequency').fill('140');
  await expect.poll(async () => (await readState(page)).renderedFrames).toBeGreaterThan(fast.renderedFrames + 2048);
  expect(await readState(page)).toMatchObject({ backend: 'wasm', audioOn: true, repeating: true, rate: 2048, settings: { modes: 32768, baseFrequency: 140 } });
  const dense = await readState(page);
  expect(Number.isFinite(dense.rms)).toBe(true); expect(dense.peak).toBeLessThanOrEqual(0.801);
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeGreaterThan(0.0001);
  await page.locator('#resetButton').click();
  expect(await readState(page)).toMatchObject({ audioOn: true, repeating: true, settings: { modes: 256 } });
  await expect(page.locator('#capacityHint')).toBeHidden();
  await page.locator('#audioButton').click();
  expect(await readState(page)).toMatchObject({ audioOn: false, repeating: true });
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeLessThan(1e-7);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect((await readState(page)).sampleRate).toBeNull();
  expect(errors).toEqual([]);
});

test('missing Wasm uses bounded compatibility playback and keyboard contact agrees with DSP', async ({ page }) => {
  await page.route('**/assets/wasm/wasm-garden.wasm', route => route.abort());
  await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
  await selectPreset(page, 'steel');
  await page.locator('#modes').selectOption('32768');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readState(page)).audioOn).toBe(true);
  expect(await readState(page)).toMatchObject({ backend: 'js', hasWasm: false, settings: { modes: 1024 } });
  await expect(page.locator('#modes option[value="32768"]')).toHaveJSProperty('disabled', true);
  await page.locator('#gardenCanvas').focus();
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readState(page)).peak).toBeGreaterThan(0.001);
  expect((await readState(page)).x).toBeCloseTo(14.5 / 32);
  expect((await readState(page)).y).toBe(0.08);
  await selectPreset(page, 'scrape');
  expect((await readState(page)).settings.modes).toBe(1024);
});

for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
  test(`material controls and gesture surface remain reachable at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const bounds = await page.locator('#gardenCanvas').boundingBox();
    expect(bounds.height).toBeGreaterThan(220);
    await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5, { steps: 5 });
    await page.mouse.up();
    expect((await readState(page)).audioOn).toBe(false);
    expect((await readState(page)).x).toBeGreaterThan(0.65);
    await page.screenshot({ path: `test-results/tines-stage-${width}x${height}.png`, fullPage: true });
    if (width === 390) {
      await page.mouse.move(width - 14, height - 80); await page.mouse.wheel(0, 600);
      await expect.poll(() => page.locator('.garden-shell').evaluate(el => el.scrollTop)).toBeGreaterThan(200);
    }
    await page.locator('#pattern').selectOption('weighted');
    await page.locator('#pitchChance').scrollIntoViewIfNeeded();
    await expect(page.locator('#pitchChance')).toBeVisible();
    await expect(page.locator('#pitchChanceBars span')).toHaveCount(32);
    await page.screenshot({ path: `test-results/tines-probability-${width}x${height}.png`, fullPage: true });
    await page.locator('#modes').scrollIntoViewIfNeeded();
    await expect(page.locator('#modes')).toBeVisible();
    await page.locator('#modes').selectOption('32768');
    await page.locator('.garden-notes summary').click();
    await page.locator('a[href="docs/wasm-garden.md"]').scrollIntoViewIfNeeded();
    await expect(page.locator('a[href="docs/wasm-garden.md"]')).toBeVisible();
    await page.screenshot({ path: `test-results/tines-controls-${width}x${height}.png`, fullPage: true });
  });
}

test('returning from model documentation leaves a playable page', async ({ page }) => {
  await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
  await page.locator('.garden-notes summary').click();
  await page.locator('a[href="docs/wasm-garden.md"]').click();
  await page.goBack({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await strikeSurface(page);
  await expect(page.locator('#liveStatus')).toContainText('Turn on Audio first');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readState(page)).audioOn).toBe(true);
});


test('pitch spread and weighted chance reach the Rust instrument without restarting playback', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
  await selectPreset(page, 'steel');
  await page.locator('#pattern').selectOption('weighted');
  await page.locator('#pitchFocus').fill('1');
  await page.locator('#chanceWidth').fill('0');
  await page.locator('#pitchSpread').fill('4');
  await page.locator('#rate').fill('2048');
  await page.locator('#playButton').click();
  expect((await readState(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readState(page)).audioOn).toBe(true);
  await expect.poll(async () => (await readState(page)).lastTine).toBe(31);
  await expect.poll(async () => (await readState(page)).appliedPitchSpread).toBe(4);
  await expect.poll(async () => (await readState(page)).peak).toBeGreaterThan(0.001);
  const high = await readState(page);
  expect(high.pitchProbabilities[31]).toBe(1);
  await page.locator('#pitchFocus').fill('0');
  await expect.poll(async () => (await readState(page)).lastTine).toBe(0);
  await expect.poll(async () => (await readState(page)).ticks).toBeGreaterThan(high.ticks);
  await page.locator('#pitchSpread').fill('0');
  await expect.poll(async () => (await readState(page)).appliedPitchSpread).toBe(0);
  expect((await readState(page)).settings).toMatchObject({ baseFrequency: 82, pitchSpread: 0 });
  await expect(page.locator('#chanceLow')).toHaveText('Tine 1');
  await page.locator('#chanceWidth').fill('1');
  expect((await readState(page)).pitchProbabilities.every(value => value === 1 / 32)).toBe(true);
  await expect(page.locator('#pitchFocus')).toBeDisabled();
  await selectPreset(page, 'weighted');
  await expect.poll(async () => (await readState(page)).appliedPitchSpread).toBe(1.5);
  expect(await readState(page)).toMatchObject({ audioOn: true, repeating: true, pitchFocus: 0.65, chanceWidth: 0.35, pattern: 'weighted' });
  await page.locator('#resetButton').click();
  await expect.poll(async () => (await readState(page)).appliedPitchSpread).toBe(Math.log2(40));
  expect(await readState(page)).toMatchObject({ audioOn: true, repeating: true, pitchFocus: 0.5, chanceWidth: 1, pattern: 'random' });
  await expect(page.locator('#pitchChance')).toBeHidden();
  expect(errors).toEqual([]);
});


test('Metal loads first, random excitation reaches both axes, and maximum bank density recovers', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await captureOutput(page);
  await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#presetSelect')).toHaveValue('original');
  await expect(page.locator('#metalLabel')).toHaveText('Metal');
  await expect(page.locator('label[for="modes"]')).toContainText('Density');
  await expect(page.locator('#pattern')).toHaveValue('random');
  await expect(page.locator('#modes')).toHaveValue('256');
  await expect(page.locator('#exciterControl')).toBeHidden();
  expect(await readState(page)).toMatchObject({ audioOn: false, rate: 3, x: 0.42, y: 0.65,
    settings: { model: 'bank', modes: 256, baseFrequency: 82, decay: 3.2, dispersion: 0.45, brightness: 0.65 } });
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await expect.poll(async () => (await readState(page)).ticks).toBeGreaterThan(0);
  const first = await readState(page);
  await expect.poll(async () => (await readState(page)).lastX).not.toBe(first.lastX);
  const next = await readState(page);
  expect(next.lastY).not.toBe(first.lastY);
  expect(next.lastX).toBeGreaterThanOrEqual(0.05); expect(next.lastX).toBeLessThanOrEqual(0.95);
  expect(next.lastY).toBeGreaterThanOrEqual(0.2); expect(next.lastY).toBeLessThanOrEqual(0.9);
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeGreaterThan(0.001);
  await selectPreset(page, 'originalWood');
  await expect(page.locator('#modes')).toHaveValue('64');
  await selectPreset(page, 'originalDense');
  await expect(page.locator('#modes')).toHaveValue('2048');
  await page.locator('#modes').selectOption('32768');
  await page.locator('#rate').fill('2048');
  await expect.poll(async () => (await readState(page)).appliedRate).toBe(2048);
  const before = await readState(page);
  await expect.poll(async () => (await readState(page)).ticks - before.ticks).toBeGreaterThan(100);
  expect((await readState(page)).peak).toBeLessThanOrEqual(0.801);
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeGreaterThan(0.0001);
  await page.locator('#gardenCanvas').focus();
  await page.locator('#pattern').selectOption('weighted');
  await page.locator('#chanceWidth').fill('0');
  await page.locator('#pitchFocus').fill('0');
  await expect(page.locator('#pitchFocusOut')).toHaveText('20% bright');
  await expect.poll(async () => (await readState(page)).lastY).toBe(0.2);
  const weightedTicks = (await readState(page)).ticks;
  await expect.poll(async () => (await readState(page)).ticks).toBeGreaterThan(weightedTicks + 100);
  expect(await readState(page)).toMatchObject({audioOn: true, repeating: true, settings: {modes: 32768}});
  await page.locator('#gardenCanvas').focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
  expect((await readState(page)).y).toBe(0);
  await selectPreset(page, 'steel');
  expect((await readState(page)).y).toBe(0.08);
  await strikeSurface(page);
  await expect.poll(async () => (await readState(page)).appliedModel).toBe('tines');
  await page.locator('#resetButton').click();
  await strikeSurface(page);
  await expect.poll(async () => (await readState(page)).appliedModel).toBe('bank');
  expect(await readState(page)).toMatchObject({ audioOn: true, repeating: true, rate: 3, pattern: 'random', settings: { modes: 256 } });
  expect(errors).toEqual([]);
});


test('Metal has an active graphic, audible Volume and real stereo header meters', async ({ page }) => {
  await captureOutput(page);
  await page.goto('wasm-garden.html', {waitUntil: 'networkidle'});
  const meters = page.locator('.header-output-meter');
  await expect(page.locator('.header-output-meter-shell')).toBeVisible();
  await expect(meters).toHaveCount(2);
  await expect(meters.nth(0)).toHaveJSProperty('value', -60);
  await expect(page.locator('#outputLevel')).toHaveAttribute('aria-label', 'Volume');
  await expect(page.locator('#outputLevel')).toHaveValue('0.8');
  const idle = await page.locator('#gardenCanvas').screenshot();
  await page.waitForTimeout(100);
  expect(await page.locator('#gardenCanvas').screenshot()).toEqual(idle);
  await page.evaluate(() => {
    const canvas = document.getElementById('gardenCanvas');
    window.__quietSurface = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    window.__changedSurfacePixels = () => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 32) if (Math.abs(pixels[i] - window.__quietSurface[i]) > 8) changed++;
      return changed;
    };
  });
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.__changedSurfacePixels())).toBeGreaterThan(1000);
  for (const meter of [meters.nth(0), meters.nth(1)]) await expect.poll(() => meter.evaluate(el => el.value)).toBeGreaterThan(-45);
  await expect.poll(() => page.evaluate(() => window.__tinesMaster.gain.value)).toBeCloseTo(0.96, 3);
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeGreaterThan(0.015);
  await page.locator('#outputLevel').fill('0');
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeLessThan(1e-7);
  for (const meter of [meters.nth(0), meters.nth(1)]) await expect.poll(() => meter.evaluate(el => el.value)).toBe(-60);
  const silentTicks = (await readState(page)).ticks;
  await page.locator('#outputLevel').fill('1');
  await expect.poll(() => page.evaluate(() => window.__tinesMaster.gain.value)).toBeCloseTo(1.2, 3);
  await expect.poll(async () => (await readState(page)).ticks).toBeGreaterThan(silentTicks);
  expect(await page.evaluate(() => window.__tinesOutputPeak())).toBeLessThan(0.96001);
  await selectPreset(page, 'originalDense');
  await page.locator('#resetButton').click();
  await expect(page.locator('#outputLevel')).toHaveValue('1');
  expect(await readState(page)).toMatchObject({audioOn: true, repeating: true, settings: {model: 'bank', modes: 256}});
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => window.__tinesOutputPeak())).toBeLessThan(1e-7);
  for (const meter of [meters.nth(0), meters.nth(1)]) await expect.poll(() => meter.evaluate(el => el.value)).toBe(-60);
  await expect(page.locator('.header-output-meter-shell')).toBeVisible();
});

test('preset row, Next, Random and Play/Pause preserve musical flow', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('wasm-garden.html', { waitUntil: 'networkidle' });
  await expect(page.locator('.garden-stage-footer, #positionOut, #gestureCue, #strikeButton')).toHaveCount(0);
  expect(await page.locator('.garden-stage').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
  expect(await page.locator('.garden-panel').evaluate(el => el.firstElementChild.id)).toBe('presetControls');
  const play = await page.locator('#playButton').boundingBox(), rate = await page.locator('#rate').boundingBox();
  expect(rate.x).toBeGreaterThan(play.x + play.width);
  expect(rate.y).toBeLessThan(play.y + play.height);
  await expect(page.locator('#presetControls .instrument-picker-current')).toHaveText('Metal');
  await page.locator('#presetControls summary').click();
  await expect(page.getByRole('searchbox', { name: 'Filter presets' })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Filter presets' }).fill('glass');
  await expect(page.locator('#garden-preset-panel [data-preset-id="originalGlass"]')).toBeVisible();
  await expect(page.locator('#garden-preset-panel [data-preset-id="original"]')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#presetControls summary')).toBeFocused();
  for (const label of ['Glass', 'Damped', 'Dense', 'Steel · mallet', 'Bronze · pick', 'Weighted strikes', 'Damped metal', 'Scraped metal', 'Metal']) {
    await page.getByRole('button', { name: 'Next preset', exact: true }).click();
    await expect(page.locator('#presetControls .instrument-picker-current')).toHaveText(label);
  }
  await page.locator('#outputLevel').fill('0.63');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  expect((await readState(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await readState(page)).audioOn).toBe(true);
  const before = await readState(page);
  await page.getByRole('button', { name: 'Randomize parameters', exact: true }).click();
  await expect(page.locator('#presetControls .instrument-picker-current')).toHaveText('Custom');
  const randomized = await readState(page);
  expect(randomized.settings).not.toEqual(before.settings);
  expect(randomized).toMatchObject({ audioOn: true, repeating: true, sampleRate: before.sampleRate });
  await expect(page.locator('#outputLevel')).toHaveValue('0.63');
  await expect.poll(async () => (await readState(page)).renderedFrames).toBeGreaterThan(before.renderedFrames + 2048);
  await page.getByRole('button', { name: 'Next preset', exact: true }).click();
  await expect(page.locator('#presetControls .instrument-picker-current')).toHaveText('Glass');
  expect(await readState(page)).toMatchObject({ audioOn: true, repeating: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  const paused = await readState(page);
  await page.waitForTimeout(150);
  expect((await readState(page)).ticks).toBe(paused.ticks);
  expect(await readState(page)).toMatchObject({ audioOn: true, repeating: false });
  expect(errors).toEqual([]);
});
