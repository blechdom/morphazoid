import { expect, test } from '@playwright/test';

const read = page => page.evaluate(() => globalThis.__MORPHAZOID_RUST_RESONATOR__.getState());
const canvas = page => page.locator('#resonatorCanvas');
async function range(page, id, value) {
  await page.locator('#' + id).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function choose(page, id, value) {
  const index = await page.locator('#' + id).evaluate((select, wanted) => [...select.options].findIndex(option => option.value === wanted), value);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.locator(`[data-select-id="${id}"] > summary`).click();
  await page.locator(`[data-select-id="${id}"] button[data-option-index="${index}"]`).click();
}
async function frame(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function marker(page) {
  const rect = await page.locator('#excitationMarker').boundingBox();
  expect(rect).not.toBeNull();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
function point(plot, x, y) { return { x: plot.left + plot.width * x, y: plot.top + plot.height * y }; }
async function markerAt(page, target) {
  await expect.poll(async () => {
    const current = await marker(page); return Math.hypot(current.x - target.x, current.y - target.y);
  }).toBeLessThan(1.5);
}
async function clickAt(page, target, touch = false) {
  if (touch) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
}

// Find the usable gesture rectangle from visible knob-controlled endpoints.
// No private plot helper or duplicated inset constants are used by these tests.
async function plotFromMarker(page) {
  await range(page, 'controlB', 220); await range(page, 'strikePosition', .04); await frame(page);
  const high = await marker(page);
  await range(page, 'controlB', 42); await range(page, 'strikePosition', .96); await frame(page);
  const low = await marker(page);
  expect(low.x).toBeGreaterThan(high.x + 100); expect(low.y).toBeGreaterThan(high.y + 50);
  const plot = { left: high.x, top: high.y, width: low.x - high.x, height: low.y - high.y };
  const rect = await canvas(page).boundingBox();
  expect(plot.left).toBeGreaterThan(rect.x); expect(low.x).toBeLessThan(rect.x + rect.width);
  expect(plot.top).toBeGreaterThan(rect.y); expect(low.y).toBeLessThan(rect.y + rect.height);
  return plot;
}

function expectBodyUnchanged(after, before) {
  for (const key of ['hardness', 'excitationStrength', 'excitationDurationMs']) expect(after[key], key).toBe(before[key]);
}

for (const [name, viewport, touch] of [
  ['desktop', { width: 1440, height: 900 }, false],
  ['portrait', { width: 390, height: 844 }, true],
  ['landscape', { width: 844, height: 390 }, true],
]) test(`${name}: pointer pitch and marker agree, with independent strike and unchanged hardness`, async ({ browser }) => {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.goto(test.info().project.use.baseURL + 'simd-resonator-rust.html');
  await expect(page.locator('#gestureXAxis')).toContainText(/strike/i);
  await expect(page.locator('#gestureYAxis')).toContainText(/pitch/i);
  await expect(page.locator('#excitationMarker')).toHaveAttribute('aria-hidden', 'true');
  const plot = await plotFromMarker(page);
  await range(page, 'hardness', .71); await range(page, 'excitationStrength', 1.1); await range(page, 'excitationDurationMs', 43);
  const before = (await read(page)).settings;
  for (const [x, y] of [[.25, .5], [.75, .5], [.75, .25], [.5, .75]]) {
    const target = point(plot, x, y); await clickAt(page, target, touch);
    const after = await read(page);
    // Equal vertical distances give equal frequency ratios, not equal Hz steps.
    const expectedPitch = 220 * (42 / 220) ** y;
    expect(Math.abs(Math.log(after.settings.baseFrequency / expectedPitch))).toBeLessThan(.015);
    expect(Math.abs(after.settings.strikePosition - (.04 + .92 * x))).toBeLessThan(.01);
    expectBodyUnchanged(after.settings, before);
    expect(after.audioOn).toBe(false); expect(after.audioReady).toBe(false);
    await markerAt(page, target);
  }
  // The small canvas margin remains playable and clamps to the complete range.
  await clickAt(page, { x: plot.left - 3, y: plot.top - 3 }, touch);
  expect((await read(page)).settings).toMatchObject({ baseFrequency: 220, strikePosition: .04 });
  await markerAt(page, point(plot, 0, 0));
  await clickAt(page, { x: plot.left + plot.width + 3, y: plot.top + plot.height + 3 }, touch);
  expect((await read(page)).settings).toMatchObject({ baseFrequency: 42, strikePosition: .96 });
  await markerAt(page, point(plot, 1, 1));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await context.close();
});

test('pitch keys use equal ratios, knobs and presets move the same marker, and Audio remains off', async ({ page }) => {
  await page.goto('simd-resonator-rust.html');
  const plot = await plotFromMarker(page);
  await range(page, 'controlB', 88); await range(page, 'strikePosition', .5); await range(page, 'hardness', .66);
  const before = (await read(page)).settings;
  await canvas(page).focus();
  await canvas(page).press('ArrowUp'); const first = (await read(page)).settings;
  await canvas(page).press('ArrowUp'); const second = (await read(page)).settings;
  expect(first.baseFrequency).toBeGreaterThan(before.baseFrequency);
  expect(first.baseFrequency / before.baseFrequency).toBeCloseTo(second.baseFrequency / first.baseFrequency, 8);
  await canvas(page).press('ArrowDown'); expect((await read(page)).settings.baseFrequency).toBeCloseTo(first.baseFrequency, 8);
  await canvas(page).press('ArrowRight'); const right = (await read(page)).settings;
  expect(right.strikePosition).toBeCloseTo(before.strikePosition + .02, 8);
  expect(right.baseFrequency).toBeCloseTo(first.baseFrequency, 8); expectBodyUnchanged(right, before);
  await canvas(page).press('Enter'); await canvas(page).press('Space');
  expect(await read(page)).toMatchObject({ audioOn: false, audioReady: false, contextState: 'none' });
  await range(page, 'controlB', 110); await range(page, 'strikePosition', .64);
  const target = point(plot, (.64 - .04) / .92, Math.log(220 / 110) / Math.log(220 / 42));
  await markerAt(page, target);
  await range(page, 'hardness', .05); await markerAt(page, target);
  await page.locator('.header-preset-picker > summary').click();
  await page.locator('button[data-preset-id="classic:resonator:glass"]').click();
  const recalled = (await read(page)).settings;
  expect(recalled.baseFrequency).toBe(96);
  await markerAt(page, point(plot, (recalled.strikePosition - .04) / .92, Math.log(220 / recalled.baseFrequency) / Math.log(220 / 42)));
});

test('without Body the labels and gestures control excitation; impulse leaves its inactive duration alone', async ({ page }) => {
  await page.goto('simd-resonator-rust.html'); const plot = await plotFromMarker(page);
  await range(page, 'controlB', 130); await range(page, 'strikePosition', .42); await range(page, 'hardness', .63);
  await choose(page, 'useSelect', 'processing'); await choose(page, 'excitationType', 'white-noise');
  await expect(page.locator('#gestureXAxis')).toContainText(/strength/i);
  await expect(page.locator('#gestureYAxis')).toContainText(/burst|length|duration/i);
  const before = (await read(page)).settings, target = point(plot, .7, .5);
  await clickAt(page, target); const shaped = (await read(page)).settings;
  expect(shaped.excitationStrength).toBeCloseTo(1.05, 2);
  expect(Math.abs(shaped.excitationDurationMs - Math.sqrt(300))).toBeLessThan(1);
  for (const key of ['baseFrequency', 'strikePosition', 'hardness']) expect(shaped[key]).toBe(before[key]);
  // Burst duration keeps its native millisecond quantization in this mode.
  await markerAt(page, point(plot, shaped.excitationStrength / 1.5, Math.log(shaped.excitationDurationMs) / Math.log(300)));
  await choose(page, 'excitationType', 'impulse');
  await expect(page.locator('#gestureYAxis')).toHaveText(/single.sample impulse/i);
  const duration = (await read(page)).settings.excitationDurationMs;
  await clickAt(page, point(plot, .3, .1));
  let after = (await read(page)).settings;
  expect(after.excitationStrength).toBeCloseTo(.45, 2); expect(after.excitationDurationMs).toBe(duration);
  await markerAt(page, point(plot, .3, .5));
  await canvas(page).press('ArrowUp'); after = (await read(page)).settings;
  expect(after.excitationDurationMs).toBe(duration);
  expect(after.baseFrequency).toBe(before.baseFrequency);
  expect((await read(page)).audioOn).toBe(false);
});

test('pointer cancellation ends the pitch drag and the next gesture starts normally', async ({ page }) => {
  await page.goto('simd-resonator-rust.html'); const plot = await plotFromMarker(page);
  await canvas(page).evaluate(element => element.addEventListener('pointerdown', event => {
    element.dataset.testPointerId = String(event.pointerId);
  }, { once: true }));
  const start = point(plot, .25, .7); await page.mouse.move(start.x, start.y); await page.mouse.down();
  const pointerId = Number(await canvas(page).getAttribute('data-test-pointer-id'));
  expect(await canvas(page).evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(true);
  await canvas(page).dispatchEvent('pointercancel', { pointerId, pointerType: 'mouse', bubbles: true });
  const cancelled = (await read(page)).settings;
  const next = point(plot, .8, .2); await page.mouse.move(next.x, next.y); await page.mouse.up();
  const after = (await read(page)).settings;
  expect(after.baseFrequency).toBe(cancelled.baseFrequency); expect(after.strikePosition).toBe(cancelled.strikePosition);
  expect(await canvas(page).evaluate((element, id) => element.hasPointerCapture(id), pointerId)).toBe(false);
  await clickAt(page, next); expect((await read(page)).settings.baseFrequency).toBeGreaterThan(cancelled.baseFrequency);
  await markerAt(page, next);
});

test('live pitch changes retain sample playback, context and multichannel recording with finite audible output', async ({ page }) => {
  test.setTimeout(45000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html'); const plot = await plotFromMarker(page);
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  await page.locator('label[for="surroundEnabled"]').click(); await choose(page, 'surroundLayout', '4-ring');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager(), context = manager.recordingContext();
    const analyser = context.createAnalyser(), silent = context.createGain();
    analyser.fftSize = 4096; silent.gain.value = 0;
    const release = manager.tapInto(context, analyser); analyser.connect(silent); silent.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    globalThis.__pitchOutput = () => {
      analyser.getFloatTimeDomainData(samples);
      return { sameContext: context === manager.recordingContext(), finite: samples.every(Number.isFinite),
        peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
    };
    globalThis.__releasePitchOutput = () => { release(); analyser.disconnect(); silent.disconnect(); };
  });
  await page.locator('#multitrackRecord').click();
  await expect.poll(async () => (await read(page)).recording.state).toBe('recording');
  const before = await read(page);
  const start = point(plot, .35, .9); await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (const y of [.7, .45, .2, .05, .85]) {
    const next = point(plot, .35, y); await page.mouse.move(next.x, next.y, { steps: 8 });
    await expect.poll(async () => (await read(page)).settings.baseFrequency).toBeGreaterThan(42);
    await expect.poll(async () => (await page.evaluate(() => globalThis.__pitchOutput())).peak).toBeGreaterThan(.00001);
    const measured = await page.evaluate(() => globalThis.__pitchOutput());
    expect(measured.sameContext).toBe(true); expect(measured.finite).toBe(true); expect(measured.peak).toBeLessThan(1);
    expect((await read(page)).recording.state).toBe('recording');
  }
  await page.mouse.up(); const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
  expect(after.input).toMatchObject({ playing: true, loop: true, sampleId: 'music-arp' });
  expect(after.contextTime).toBeGreaterThan(before.contextTime);
  await expect.poll(async () => (await read(page)).recording.seconds).toBeGreaterThan(0);
  expectBodyUnchanged(after.settings, before.settings);
  await page.locator('#multitrackRecord').click(); await expect(page.locator('#multitrackDialog')).toBeVisible();
  await page.locator('#multitrackDiscard').click();
  await page.evaluate(() => globalThis.__releasePitchOutput());
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).contextState).toBe('none');
  expect(errors).toEqual([]);
});
