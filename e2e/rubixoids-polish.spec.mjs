import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { enforceRubixoidsOwnership } from './helpers/rubixoids-ownership.mjs';

enforceRubixoidsOwnership(test, expect);

async function hyperView(page) {
  await page.goto('/rubixoids.html?dimension=4d');
  await expect.poll(() => page.evaluate(() => window.__rubixoidsSnapshot?.().dimension)).toBe('4d');
  const view = page.locator('.rubixoids-pane[data-dimension="4d"]');
  await expect(view).toBeVisible();
  await expect(page.locator('body > .masthead #audioButton')).toBeEnabled();
  return view;
}
const mainAudio = page => page.locator('body > .masthead #audioButton');
const mainPlay = page => page.locator('body > .rubixoids-bar #playButton');
const captureHyper = page => page.evaluate(async () => {
  const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
  return rubixoidsInstrument('4d').bridge.capture();
});
const setRange = (view, id, value) => view.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`4D transparency follows sounding cubes without changing sound at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const frames = [];
      const fill = CanvasRenderingContext2D.prototype.fill;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.id === 'stage' && this.canvas.getRootNode().host?.dataset.dimension === '4d') {
          frames.push([]); if (frames.length > 12) frames.shift();
        }
        return clear.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.fill = function (...args) {
        if (this.canvas.id === 'stage' && this.canvas.getRootNode().host?.dataset.dimension === '4d' && this.fillStyle === '#030405') frames.at(-1)?.push(this.globalAlpha);
        return fill.apply(this, args);
      };
      window.__stickerOpacityFrames = frames;
    });
    const view = await hyperView(page);
    await view.locator('[data-section="hyperspace"]').evaluate(section => { section.open = true; });
    const knob = view.locator('#nonPlayingTransparency');
    await knob.scrollIntoViewIfNeeded();
    await expect(knob).toHaveValue('0');
    expect((await knob.boundingBox()).width).toBeGreaterThanOrEqual(48);
    await mainAudio(page).click();
    await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
    await mainPlay(page).click();
    const settings = (await captureHyper(page)).settings;
    await setRange(view, 'nonPlayingTransparency', 75);
    await expect.poll(() => page.evaluate(() => window.__stickerOpacityFrames.some(alphas => alphas.includes(.25) && alphas.includes(1)))).toBe(true);
    const during = await captureHyper(page);
    expect(during.playing).toBe(true); expect(during.audioOn).toBe(true);
    // The native settings include moving cursors; compare musical controls only.
    for (const key of ['output', 'voice', 'tempo', 'tone', 'decay', 'playbackPreset', 'sequenceMethod', 'topologyLevel']) expect(during.settings[key], key).toEqual(settings[key]);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 450 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    await knob.press('End');
    await expect(knob).toHaveValue('100');
    await expect(view.locator('#stage')).toHaveAttribute('data-non-playing-transparency', '100');
    await view.locator('#stage').screenshot({ path: info.outputPath('sounding-only.png') });
    await mainPlay(page).click();
    await expect.poll(() => page.evaluate(() => window.__stickerOpacityFrames.at(-1)?.filter(alpha => alpha === 1).length ?? 0)).toBeGreaterThan(100);
    // Native keyboard operation, drag capture and cancellation remain available.
    await knob.press('Home'); await expect(knob).toHaveValue('0');
    await knob.press('ArrowUp'); await expect(knob).toHaveValue('1');
    const bounds = await knob.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 30, { steps: 5 }); await page.mouse.up();
    expect(Number(await knob.inputValue())).toBeGreaterThan(15);
    // Pointer cancellation must end the gesture before the next move.
    await knob.scrollIntoViewIfNeeded();
    const cancelBounds = await knob.boundingBox();
    await page.mouse.move(cancelBounds.x + 32, cancelBounds.y + 32);
    await page.mouse.down();
    await knob.dispatchEvent('pointercancel', { pointerId: 1 });
    const cancelledValue = await knob.inputValue();
    await page.mouse.move(cancelBounds.x + 32, cancelBounds.y - 30);
    await page.mouse.up();
    await expect(knob).toHaveValue(cancelledValue);
    await view.locator('#nonPlayingFadeMode').selectOption('scope');
    await setRange(view, 'nonPlayingTransparency', 75);
    await expect(view.locator('#stage')).toHaveAttribute('data-non-playing-fade-mode', 'scope');
    await expect.poll(() => page.evaluate(() => window.__stickerOpacityFrames.some(alphas => alphas.includes(.25) && alphas.includes(1)))).toBe(true);
    // Scope follows the selected algorithm, including corner-only streams.
    await view.locator('#playbackPreset').selectOption('whole-shape');
    await page.evaluate(() => { window.__stickerOpacityFrames.length = 0; });
    await view.locator('#sequenceMethod').selectOption('corner-stream');
    await expect.poll(() => page.evaluate(() => window.__stickerOpacityFrames.some(alphas => alphas.includes(.25) && alphas.includes(1)))).toBe(true);
    await view.locator('#playbackPreset').selectOption('selected-cell');
    await page.evaluate(() => { window.__stickerOpacityFrames.length = 0; });
    await view.locator('#sequenceMethod').selectOption('sticker-hyperbar');
    await expect(view.locator('#playbackPreset')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__stickerOpacityFrames.at(-1)?.filter(alpha => alpha === 1).length ?? 0)).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.__stickerOpacityFrames.at(-1)?.includes(.25))).toBe(false);
    await page.locator('button[data-dimension="3d"]').click();
    await expect.poll(() => page.evaluate(() => window.__rubixoidsSnapshot().dimension)).toBe('3d');
    await page.locator('button[data-dimension="4d"]').click();
    await expect.poll(() => page.evaluate(() => window.__rubixoidsSnapshot().dimension)).toBe('4d');
    await expect(knob).toHaveValue('75');
    await expect(view.locator('#nonPlayingFadeMode')).toHaveValue('scope');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}


test('fixed output calibration lifts quiet notes and bounds 4D reconstruction peaks', async ({ page }) => {
  await page.goto('/rubixoids.html');
  const renders = await page.evaluate(async () => {
    const { createRubixOutputStage } = await import('/src/instruments/rubixoids/rubix/rubix-mix.js');
    const results = [];
    for (const gain of [2, 3]) {
      const context = new OfflineAudioContext(1, 48000, 48000);
      const source = context.createBufferSource();
      const buffer = context.createBuffer(1, 48000, 48000);
      const data = buffer.getChannelData(0);
      for (let i = 4800; i < 14400; i++) data[i] = .05 * Math.sin(2 * Math.PI * 400 * i / 48000);
      // Abrupt overloaded attacks exercise oversampling reconstruction, not
      // just the mathematical bounds of the curve's lookup table.
      for (let i = 14400; i < 33600; i++) data[i] = 8 * Math.sign(Math.sin(i * .071) + Math.sin(i * .611));
      source.buffer = buffer;
      const stage = createRubixOutputStage(context, gain, gain === 3 ? { peakCeiling: .9 } : {});
      source.connect(stage.makeup); stage.output.connect(context.destination); source.start();
      const samples = (await context.startRendering()).getChannelData(0);
      const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      results.push({
        gain, finite: samples.every(Number.isFinite),
        quietRms: rms(samples.slice(6000, 13200)),
        peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
        beforeRms: rms(samples.slice(0, 4000)), afterRms: rms(samples.slice(40000)),
      });
    }
    return results;
  });
  for (const result of renders) {
    expect(result.finite).toBe(true);
    expect(result.quietRms).toBeCloseTo(.05 * result.gain / Math.sqrt(2), 3);
    expect(result.beforeRms).toBe(0); expect(result.afterRms).toBe(0);
  }
  expect(renders[1].peak).toBeLessThanOrEqual(.900001);
  expect(renders[1].peak).toBeGreaterThan(.7);
});


test('Pausing between 4D pulses restores opaque stickers without relying on an active animation', async ({ page }) => {
  await page.addInitScript(() => {
    const evidence = { sawSounding: false, frames: 0, fillCount: 0, opaqueCount: 0 };
    const fill = CanvasRenderingContext2D.prototype.fill;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    const isHyperStage = context => context.canvas.id === 'stage'
      && context.canvas.getRootNode().host?.dataset.dimension === '4d';
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (isHyperStage(this)) {
        evidence.frames += 1;
        evidence.fillCount = 0;
        evidence.opaqueCount = 0;
        evidence.sawSounding ||= Number(this.canvas.dataset.soundingStickerCount) > 0;
      }
      return clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (isHyperStage(this) && this.fillStyle === '#030405') {
        evidence.fillCount += 1;
        if (this.globalAlpha === 1) evidence.opaqueCount += 1;
      }
      return fill.apply(this, args);
    };
    window.__pauseOpacityEvidence = evidence;
  });
  const view = await hyperView(page);
  await setRange(view, 'tempo', 35);
  await view.locator('#decay').evaluate(input => {
    input.value = input.min;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await setRange(view, 'nonPlayingTransparency', 100);
  await mainAudio(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
  await mainPlay(page).click();
  // A slow clock and shortest tail leave a genuine quiet interval. Waiting
  // until no display frame is pending catches a missing pause invalidation.
  const framesBeforePause = await page.evaluate(() => new Promise((resolve, reject) => {
    const deadline = performance.now() + 5000;
    const pauseBetweenNotes = () => {
      const capture = window.__rubixoidsSnapshot().dimensions['4d'];
      const evidence = window.__pauseOpacityEvidence;
      if (capture.playing && evidence.sawSounding && evidence.fillCount === 0
        && !capture.diagnostics.animationActive) {
        const frames = evidence.frames;
        // Trigger the real shared button in this same task; another scheduled
        // note cannot slip between detecting the quiet interval and pausing.
        document.querySelector('body > .rubixoids-bar #playButton').click();
        resolve(frames);
      } else if (performance.now() > deadline) {
        reject(new Error('No between-note interval without an active animation'));
      } else setTimeout(pauseBetweenNotes, 8);
    };
    pauseBetweenNotes();
  }));
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => window.__pauseOpacityEvidence.frames)).toBeGreaterThan(framesBeforePause);
  await expect.poll(() => page.evaluate(() => window.__pauseOpacityEvidence.opaqueCount)).toBeGreaterThan(100);
  const paused = await captureHyper(page);
  expect(paused.playing).toBe(false);
  expect(paused.audioOn).toBe(true);
  expect(paused.diagnostics.schedulerActive).toBe(false);
});


test('Native keyboard gestures keep form ownership and affect only the active Rubixoids instrument', async ({ page }) => {
  await page.goto('/rubixoids.html');
  await expect.poll(() => page.evaluate(() => window.__rubixoidsSnapshot?.().dimension)).toBe('3d');
  await expect(mainAudio(page)).toBeEnabled();
  const capture = dimension => page.evaluate(async dimension => {
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    return rubixoidsInstrument(dimension).bridge.capture();
  }, dimension);
  const choose = async dimension => {
    await page.locator(`.rubixoids-dimensions button[data-dimension="${dimension}"]`).click();
    await expect.poll(() => page.evaluate(() => window.__rubixoidsSnapshot().dimension)).toBe(dimension);
    await expect(mainAudio(page)).toBeEnabled();
    return page.locator(`.rubixoids-pane[data-dimension="${dimension}"]`);
  };
  const editTempo = async (view, dimension) => {
    const tempo = page.locator('body > .rubixoids-bar #tempo');
    const before = Number(await tempo.inputValue());
    const step = Number(await tempo.getAttribute('step')) || 1;
    await tempo.press('ArrowUp');
    await expect(tempo).toHaveValue(String(before + step));
    await tempo.press('Space');
    const state = await capture(dimension);
    expect(state.playing).toBe(false);
    expect(state.audioOn).toBe(false);
  };
  const pressPageSpace = async () => {
    await page.evaluate(() => {
      document.activeElement?.shadowRoot?.activeElement?.blur();
      document.activeElement?.blur();
    });
    await page.keyboard.press('Space');
  };

  const cube = page.locator('.rubixoids-pane[data-dimension="3d"]');
  const cubeBefore = await capture('3d');
  await editTempo(cube, '3d');
  expect((await capture('3d')).native.cube).toEqual(cubeBefore.native.cube);
  await cube.locator('#stage').press('Space');
  expect((await capture('3d')).playing).toBe(false);
  expect((await capture('3d')).audioOn).toBe(false);
  await cube.locator('#stage').press('ArrowRight');
  await expect.poll(async () => (await capture('3d')).native.moveHistory.length).toBe(cubeBefore.native.moveHistory.length + 1);
  const turnedCube = (await capture('3d')).native.cube;
  expect(turnedCube).not.toEqual(cubeBefore.native.cube);

  const sliding = await choose('2d');
  const slidingBefore = await capture('2d');
  await editTempo(sliding, '2d');
  expect((await capture('2d')).native.puzzle).toEqual(slidingBefore.native.puzzle);
  await sliding.locator('.sliding-tile.can-slide').first().press('ArrowUp');
  await expect.poll(async () => (await capture('2d')).native.history.length).toBe(slidingBefore.native.history.length + 1);
  const movedTiles = (await capture('2d')).native.puzzle;
  expect(movedTiles).not.toEqual(slidingBefore.native.puzzle);
  await pressPageSpace();
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
  expect((await capture('2d')).playing).toBe(true);
  expect((await capture('2d')).audioOn).toBe(false);
  expect((await capture('3d')).native.cube).toEqual(turnedCube);
  expect((await capture('3d')).playing).toBe(false);
  await pressPageSpace();
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'false');

  const hyper = await choose('4d');
  const hyperBefore = await capture('4d');
  await editTempo(hyper, '4d');
  expect((await capture('4d')).native.puzzle).toEqual(hyperBefore.native.puzzle);
  await hyper.locator('#stage').press('ArrowRight');
  expect((await capture('4d')).settings.cameraYaw).toBe(hyperBefore.settings.cameraYaw + 4);
  await hyper.locator('#stage').press('Space');
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
  expect((await capture('4d')).audioOn).toBe(false);
  expect((await capture('3d')).native.cube).toEqual(turnedCube);
  expect((await capture('2d')).native.puzzle).toEqual(movedTiles);
  expect((await capture('2d')).playing).toBe(false);
  await hyper.locator('#stage').press('Space');
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'false');
});
