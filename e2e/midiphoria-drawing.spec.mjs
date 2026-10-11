import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { MidiDrawing } from '../src/instruments/midiphoria/midiphoria-drawing.js';
import { generateGridMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.addInitScript(() => {
    window.__drawingContexts = []; window.__drawingQA = { engine: null, launches: [] };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__drawingContexts.push(this); }
    };
  });
  // Observe the existing native engine without replacing its audio path.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume=MidiMixerEngine.prototype.setVolume,qaTrigger=MidiMixerEngine.prototype.triggerSample;
      MidiMixerEngine.prototype.setVolume=function(...args){__drawingQA.engine=this;return qaVolume.apply(this,args);};
      MidiMixerEngine.prototype.triggerSample=function(buffer,...args){const sample=qaTrigger.call(this,buffer,...args);
        if(sample)__drawingQA.launches.push({id:sample.id,bytes:Array.from(new Uint8Array(buffer))});return sample;};` });
  });
  await page.goto('/blech-midi.html');
  await page.locator('#drawingModeButton').click();
  await expect(page.locator('#drawingCanvas')).toBeVisible();
}

async function gridPoint(page, x, y) {
  await page.locator('#drawingCanvas').scrollIntoViewIfNeeded();
  return page.locator('#drawingCanvas').evaluate((canvas, point) => {
    const rect = canvas.getBoundingClientRect();
    const cell = Math.min((rect.width - 28) / 48, (rect.height - 52) / 32);
    return { x: rect.left + (rect.width - cell * 48) / 2 + (point.x + .5) * cell,
      y: rect.top + (rect.height - cell * 32) / 2 + (point.y + .5) * cell };
  }, { x, y });
}

async function stamp(page, kind = '⭐') {
  await page.locator(`[data-drawing-stamp="${kind}"]`).click();
  await expect(page.locator('#generateDrawingMidi')).toBeEnabled();
}

test('fast freehand and eraser drags interpolate, cancel safely, and undo one whole gesture', async ({ page }) => {
  await open(page);
  const start = await gridPoint(page, 0, 31), end = await gridPoint(page, 47, 0);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '48');
  await page.locator('#drawingUndo').click();
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '0');
  await expect(page.locator('#drawingUndo')).toBeDisabled();
  await stamp(page);
  const before = await page.locator('#drawingCanvas').getAttribute('data-pixels');
  await page.locator('#drawingErase').click();
  const left = await gridPoint(page, 0, 15), right = await gridPoint(page, 47, 15);
  await page.mouse.move(left.x, left.y); await page.mouse.down(); await page.mouse.move(right.x, right.y); await page.mouse.up();
  expect(Number(await page.locator('#drawingCanvas').getAttribute('data-pixels'))).toBeLessThan(Number(before));
  await page.locator('#drawingUndo').click(); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', before);
  await page.locator('#drawingClear').click();
  await page.locator('#drawingErase').click();
  const resumed = await gridPoint(page, 0, 31), resumedEnd = await gridPoint(page, 47, 0);
  await page.mouse.move(resumed.x, resumed.y); await page.mouse.down();
  await page.locator('#drawingCanvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.move(resumedEnd.x, resumedEnd.y); await page.mouse.up();
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '1');
  await page.locator('#drawingUndo').click(); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '0');
  await page.locator('#drawingCanvas').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '1');
  await page.keyboard.press('Delete'); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '0');
  expect(await page.evaluate(() => window.__drawingContexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('Send retains its draft and downloads exactly the played notes without enabling Audio', async ({ page }) => {
  await open(page); await stamp(page);
  await expect(page.locator('#generateDrawingMidi')).toHaveText('Send ↑');
  await page.locator('#generateDrawingMidi').click();
  await expect.poll(() => page.evaluate(() => __drawingQA.launches.length)).toBe(1);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-view', 'draw');
  await expect(page.locator('#drawingCanvas')).toBeVisible();
  await expect(page.locator('#creativeVisualizerHost #mixerPerformanceCanvas')).toBeVisible();
  const waiting = page.waitForEvent('download'); await page.locator('#downloadDrawingMidi').click();
  const download = await waiting, expected = new MidiDrawing(); expected.stamp('⭐');
  const bytes = await readFile(await download.path());
  // In the rising trail view the top of the picture must sound first.
  // Derive that orientation directly from displayed cells, independently of
  // the production performance-score adapter.
  const score = generateGridMidi([...expected.pixels].reverse(), { title: 'Drawn score', secondsPerRow: .125 });
  expect(bytes).toEqual(Buffer.from(score.buffer));
  expect(Array.from(bytes)).toEqual(await page.evaluate(() => __drawingQA.launches.at(-1).bytes));
  expect(download.suggestedFilename()).toBe('blech-drawing.mid');
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', String(expected.count));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__drawingContexts.length)).toBe(0);
});

test('a drawn score sounds in Draw and further edits preserve the active loop', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await stamp(page, 'wave'); await page.locator('#mixerSampleLoop').check();
  await page.locator('#audioButton').click(); await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await page.locator('#generateDrawingMidi').click();
  await expect.poll(() => page.evaluate(() => __drawingQA.engine.state.samples.length)).toBe(1);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-view', 'draw');
  await expect.poll(() => page.evaluate(() => __drawingQA.engine.state.samples[0]?.positionBeats)).toBeGreaterThan(.3);
  const signal = await sampleAudioEnvelope(page, { durationMs: 600 });
  expect(signal.summary.finite).toBe(true); expect(signal.summary.maxRms).toBeGreaterThan(.002); expect(signal.summary.clippedSamples).toBe(0);
  const id = await page.evaluate(() => __drawingQA.engine.state.samples[0].id);
  const sent = await page.evaluate(() => JSON.stringify(__drawingQA.engine.state.samples[0].analysis.notes));
  await stamp(page, 'spiral');
  expect(await page.evaluate(() => JSON.stringify(__drawingQA.engine.state.samples[0].analysis.notes))).toBe(sent);
  expect(await page.evaluate(id => __drawingQA.engine.state.samples.some(sample => sample.id === id), id)).toBe(true);
  await page.locator('#generateDrawingMidi').click();
  await expect.poll(() => page.evaluate(() => __drawingQA.launches.length)).toBe(2);
  await expect(page.locator('#drawingCanvas')).toBeVisible();
  expect(await page.evaluate(() => window.__drawingContexts.length)).toBe(1);
  await page.locator('#audioButton').click();
  await stamp(page, '❤'); await page.locator('#generateDrawingMidi').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`draw controls and rectangular stage fit ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
    const page = await context.newPage();
    try {
      await open(page); await stamp(page, '🙂');
      for (const id of ['drawingCanvas', 'generateDrawingMidi', 'drawingUndo', 'drawingClear', 'drawingErase', 'creativeTempo', 'creativeStop']) {
        await page.locator(`#${id}`).scrollIntoViewIfNeeded();
        const bounds = await page.locator(`#${id}`).boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
        if (viewport.width < 1000) { expect(bounds.width).toBeGreaterThanOrEqual(48); expect(bounds.height).toBeGreaterThanOrEqual(48); }
      }
      const order = await page.evaluate(() => {
        const live = document.getElementById('creativeVisualizerHost').getBoundingClientRect();
        const draft = document.getElementById('drawingEditor').getBoundingClientRect();
        return { liveBottom: live.bottom, draftTop: draft.top };
      });
      expect(order.draftTop).toBeGreaterThanOrEqual(order.liveBottom);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await page.locator('#drawingCanvas').evaluate(node => getComputedStyle(node).borderRadius)).toBe('0px');
      await page.locator('#drawingModeButton').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('drawing-controls.png') });
      await page.locator('#drawingCanvas').screenshot({ path: testInfo.outputPath('drawing-score.png') });
    } finally { await context.close(); }
  });
}
