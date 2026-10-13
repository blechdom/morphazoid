import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(async () =>
  (await import('/src/instruments/vector-fractals/app.js')).diagnosticSnapshot());
const ready = page => expect.poll(async () => {
  const s = await snapshot(page);
  return s.ready && !s.building && s.trace.ready && !s.contours.navigation.pending;
}, { timeout: 40000 }).toBe(true);

async function reveal(page, id) {
  const control = page.locator(`#${id}`);
  await control.evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
  });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  return control;
}

async function range(page, id, value) {
  const control = await reveal(page, id);
  await control.evaluate((node, value) => {
    node.value = String(value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function traveler(page) {
  await page.goto('vector-fractals.html#explorer');
  await ready(page);
  await page.locator('#contourReader').selectOption('traveler');
  await ready(page);
  await expect(page.locator('#motifTools')).toBeVisible();
}

async function capture(page, name, center = .3) {
  await range(page, 'motifCenter', center);
  await range(page, 'motifSpan', .24);
  const button = await reveal(page, `motifCapture${name}`);
  await button.focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect.poll(async () => Boolean((await snapshot(page)).state.motifCaptures['ABC'.indexOf(name)])).toBe(true);
}

async function example(page, value) {
  await (await reveal(page, 'motifExample')).selectOption(value);
  await (await reveal(page, 'motifLoadExample')).click();
  await ready(page);
  await expect.poll(async () => Boolean((await snapshot(page)).state.motifCaptures[1])).toBe(true);
}

const hits = s => s.trace.drumTriggerCounts.reduce((sum, count) => sum + count, 0);

test('motifs capture by keyboard, survive refinements, and compare without arming Audio', async ({ page }) => {
  test.setTimeout(110000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await traveler(page);
  await capture(page, 'A');
  const original = (await snapshot(page)).state.motifCaptures[0];
  await example(page, 'copy');
  await (await reveal(page, 'travelerMode')).selectOption('compare');
  await ready(page);
  await expect(page.locator('#motifComparison')).toBeVisible();
  await expect(page.locator('#motifOverlay')).toHaveCSS('pointer-events', 'none');
  await page.locator('#playButton').click();
  let s = await snapshot(page);
  expect(s.state.travelerMode).toBe('compare');
  expect(s.trace.motif).toBe(true);
  expect(s.motifs.bankActive).toBe(true);
  expect(s.playing).toBe(true);
  expect(s.armed).toBe(false);
  expect(s.audioTime).toBeNull();

  for (const value of ['resampled', 'mirror', 'different']) await example(page, value);
  await (await reveal(page, 'motifMirror')).check();
  await (await reveal(page, 'motifReverse')).check();
  await range(page, 'motifElastic', .08);
  await (await reveal(page, 'motifTiming')).selectOption('original');
  await ready(page);
  s = await snapshot(page);
  expect(s.state.motifMirror).toBe(true);
  expect(s.state.motifReverse).toBe(true);
  expect(s.state.motifElastic).toBeCloseTo(.08, 4);
  expect(s.state.motifTiming).toBe('original');
  expect(s.playing).toBe(true);
  expect(s.armed).toBe(false);
  expect(s.state.motifCaptures[0]).toEqual(original);

  // A capture belongs to its original contour, even after the viewport refines.
  await page.locator('#contourStage').scrollIntoViewIfNeeded();
  await page.locator('#contourStage').focus();
  await page.keyboard.press('+');
  await ready(page);
  expect((await snapshot(page)).state.motifCaptures[0]).toEqual(original);
  await (await reveal(page, 'motifPick')).selectOption('b');
  await page.locator('#contourReader').selectOption('scan');
  await ready(page);
  await expect(page.locator('#motifTools')).toBeHidden();
  await page.locator('#contourReader').selectOption('traveler');
  await ready(page);
  await expect(page.locator('#motifPick')).toHaveValue('none');
  expect((await snapshot(page)).state.motifCaptures[0]).toEqual(original);
  expect(errors).toEqual([]);
});

test('picking a motif leaves drag navigation intact and visible matches can be selected', async ({ page }) => {
  test.setTimeout(110000);
  await traveler(page);
  await (await reveal(page, 'motifPick')).selectOption('a');
  const before = await snapshot(page);
  const canvas = page.locator('#contourStage');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5 + 28, box.y + box.height * .5 + 10, { steps: 5 });
  await page.mouse.up();
  await ready(page);
  let s = await snapshot(page);
  expect(s.state.motifCaptures).toEqual(before.state.motifCaptures);
  expect(s.state.viewX).not.toBe(before.state.viewX);

  // Select an actual displayed head rather than injecting geometry into the app.
  const point = s.contours.renderer.traceHeads.find(head => head.index === 2);
  expect(point).toBeTruthy();
  const view = s.contours.navigation.view;
  const currentBox = await canvas.boundingBox();
  await page.mouse.click(
    currentBox.x + (.5 + (point.x - view.x) / view.width) * currentBox.width,
    currentBox.y + (.5 - (point.y - view.y) / view.width * view.aspect) * currentBox.height,
  );
  await ready(page);
  await expect.poll(async () => Boolean((await snapshot(page)).state.motifCaptures[0])).toBe(true);
  await (await reveal(page, 'motifFind')).click();
  await expect.poll(async () => Boolean((await snapshot(page)).motifs?.searching), { timeout: 40000 }).toBe(false);
  await expect.poll(async () => page.locator('#motifMatches option').evaluateAll(options =>
    options.filter(option => !option.disabled && option.value !== '').length), { timeout: 40000 }).toBeGreaterThan(0);
  const matches = await reveal(page, 'motifMatches');
  const value = await matches.locator('option').evaluateAll(options =>
    options.find(option => !option.disabled && option.value !== '')?.value);
  await matches.selectOption(value);
  await ready(page);
  s = await snapshot(page);
  expect(s.state.motifCaptures[1]).toBeTruthy();
  expect(s.armed).toBe(false);
  expect(s.audioTime).toBeNull();
});

test('motif playback, optional cues, and turn drums keep the audio clock and release cleanly', async ({ page }, testInfo) => {
  test.setTimeout(150000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await traveler(page);
  await capture(page, 'A', .27);
  await example(page, 'copy');
  await capture(page, 'C', .7);
  await range(page, 'traceRate', .6);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  const observations = [];
  for (const mode of ['compare', 'choir', 'detail', 'path']) {
    const before = await snapshot(page);
    await (await reveal(page, 'travelerMode')).selectOption(mode);
    await ready(page);
    const audio = await sampleAudioEnvelope(page, { durationMs: 850, intervalMs: 50 });
    const s = await snapshot(page);
    expect(s.state.travelerMode).toBe(mode);
    expect(s.trace.motif).toBe(mode !== 'path');
    expect(s.motifs.bankActive).toBe(mode !== 'path');
    expect(s.playing && s.armed).toBe(true);
    expect(s.trace.travel).toBeGreaterThan(before.trace.travel);
    expect(audio.summary.finite).toBe(true);
    expect(audio.summary.maxPeak).toBeGreaterThan(.001);
    expect(audio.summary.clippedSamples).toBe(0);
    observations.push({ mode, audio: audio.summary });
    if (mode === 'compare') {
      await expect(page.locator('#layerVoice1')).toBeDisabled();
      await (await reveal(page, 'motifSameVoice')).uncheck();
      await expect(page.locator('#layerVoice1')).toBeEnabled();
      await page.locator('#layerVoice1').selectOption('glass');
      await (await reveal(page, 'motifSameVoice')).check();
      await expect(page.locator('#layerVoice1')).toBeDisabled();
      expect((await snapshot(page)).state.motifSameVoice).toBe(true);
      expect((await snapshot(page)).playing && (await snapshot(page)).armed).toBe(true);
    } else await expect(page.locator('#layerVoice1')).toBeEnabled();
    if (mode === 'detail') {
      await expect(page.locator('#motifAnalysis')).toContainText('share one captured curve');
      await expect(page.locator('#motifComparison')).not.toHaveAttribute('aria-label', /A \/ B/);
    }
  }
  await (await reveal(page, 'travelerMode')).selectOption('choir');
  await (await reveal(page, 'motifTiming')).selectOption('original');
  await (await reveal(page, 'motifScaleCue')).selectOption('register');
  await range(page, 'motifScaleAmount', .7);
  await range(page, 'motifOrientation', .75);
  await (await reveal(page, 'travelerDetrend')).check();
  await ready(page);
  let s = await snapshot(page);
  expect(s.state.motifTiming).toBe('original');
  expect(s.state.motifScaleCue).toBe('register');
  expect(s.state.motifScaleAmount).toBeCloseTo(.7, 4);
  expect(s.state.motifOrientation).toBeCloseTo(.75, 4);
  expect(s.state.travelerDetrend).toBe(true);
  expect(s.playing && s.armed).toBe(true);
  await (await reveal(page, 'motifScaleCue')).selectOption('timbre');
  await (await reveal(page, 'travelerMode')).selectOption('path');
  await (await reveal(page, 'drumPlacement')).selectOption('turn');
  await range(page, 'drumTurnStep', 30);
  await (await reveal(page, 'drumTurnColor')).check();
  for (let index = 0; index < 3; index++) {
    await page.locator(`#layerDrums${index}`).check();
    await page.locator(`#layerSustain${index}`).uncheck();
  }
  await ready(page);
  const beforeHits = hits(await snapshot(page));
  await expect.poll(async () => hits(await snapshot(page)), { timeout: 6000 }).toBeGreaterThan(beforeHits);
  const beforeStall = await snapshot(page);
  await page.evaluate(() => { const until = performance.now() + 300; while (performance.now() < until) {} });
  await page.waitForTimeout(150);
  s = await snapshot(page);
  expect(s.trace.travel - beforeStall.trace.travel).toBeCloseTo((s.audioTime - beforeStall.audioTime) * .6, 1);
  expect(s.playing && s.armed).toBe(true);
  await page.locator('#playButton').click();
  await page.waitForTimeout(650);
  const paused = await snapshot(page);
  await page.waitForTimeout(120);
  expect((await snapshot(page)).trace.travel).toBeCloseTo(paused.trace.travel, 5);
  expect((await sampleAudioEnvelope(page, { durationMs: 200 })).summary.maxPeak).toBeLessThan(.001);
  await page.evaluate(async () => (await import('/src/instruments/vector-fractals/app.js')).dispose());
  expect((await snapshot(page)).audioTime).toBeNull();
  expect(errors).toEqual([]);
  await testInfo.attach('motif-audio.json', { body: JSON.stringify(observations), contentType: 'application/json' });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`Motif layout ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, ...(viewport.width < 1000 ? { hasTouch: true, isMobile: true } : {}) });
    test('selection and listening controls stay reachable', async ({ page }, testInfo) => {
      test.setTimeout(90000);
      await traveler(page);
      await capture(page, 'A');
      await example(page, 'copy');
      await (await reveal(page, 'travelerMode')).selectOption('compare');
      await ready(page);
      for (const id of ['travelerMode', 'motifCaptureB', 'motifPick', 'motifCenter', 'motifSpan', 'motifTiming', 'motifDetail', 'motifMirror', 'motifScaleCue', 'motifOrientation']) {
        const control = await reveal(page, id);
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(-1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      for (const id of ['motifDetail', 'motifElastic', 'motifScaleAmount', 'motifOrientation', 'motifDetailGain']) {
        const control = await reveal(page, id);
        const text = await control.evaluate(node => {
          const field = node.closest('.control');
          const label = field.querySelector('.mz-field__label').getBoundingClientRect();
          const output = field.querySelector('.mz-field__output').getBoundingClientRect();
          return { labelBottom: label.bottom, outputTop: output.top };
        });
        expect(text.labelBottom, `${id}: its label must not overlap its value`).toBeLessThanOrEqual(text.outputTop);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      for (const id of ['audioButton', 'playButton']) {
        const target = await reveal(page, id);
        const box = await target.boundingBox();
        if (viewport.width < 1000 || id === 'playButton') {
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
      }
      await page.locator('#playButton').click();
      const s = await snapshot(page);
      expect(s.playing).toBe(true);
      expect(s.armed).toBe(false);
      expect(s.audioTime).toBeNull();
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath('motif-layout.png'), fullPage: true });
    });
  });
}
