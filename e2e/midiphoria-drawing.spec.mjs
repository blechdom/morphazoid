import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { MidiDrawing } from '../src/instruments/midiphoria/midiphoria-drawing.js';
import { generateTextMidi } from '../src/instruments/midiphoria/midiphoria-text-midi.js';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { selectedSong } from './helpers/midiphoria-library.mjs';

async function open(page) {
  await page.addInitScript(() => {
    window.__drawingContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__drawingContexts.push(this); }
    };
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#songCount')).toHaveText('100 MIDIs');
  await page.locator('#drawingModeButton').click();
  await expect(page.locator('#drawingCanvas')).toBeVisible();
}

async function gridPoint(page, x, y) {
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
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.locator('#drawingCanvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.move(end.x, end.y); await page.mouse.up();
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '1');
  await page.locator('#drawingUndo').click(); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '0');
  await page.locator('#drawingCanvas').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space');
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '1');
  await page.keyboard.press('Delete'); await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', '0');
  expect(await page.evaluate(() => window.__drawingContexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('drawing and emoji generation download exactly the displayed notes without silently enabling Audio', async ({ page }) => {
  await open(page); await stamp(page);
  await page.locator('#generateDrawingMidi').click();
  await expect(selectedSong(page)).toHaveAttribute('data-song-id', 'drawing-midi');
  await expect(page.locator('#drawingCanvas')).toBeHidden();
  await expect(page.locator('#visualCanvas')).toHaveAttribute('data-display', 'letters');
  await expect(page.locator('#visualCanvas')).toHaveAttribute('aria-label', /bottom to top/);
  const waiting = page.waitForEvent('download'); await page.locator('#downloadTextMidi').click();
  const download = await waiting, expected = new MidiDrawing(); expected.stamp('⭐');
  expect(await readFile(await download.path())).toEqual(Buffer.from(expected.score().buffer));
  expect(download.suggestedFilename()).toBe('drawn-score.mid');
  await page.locator('#drawingModeButton').click();
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', String(expected.count));
  await page.locator('#textMidiInput').fill('HI 🙂 🦄 ⭐');
  await page.locator('#textMidiMode').selectOption('letter');
  await page.locator('#generateTextMidi').click();
  await expect(page.locator('#textMidiStatus')).toContainText('Skipped unsupported characters: 🦄');
  const next = page.waitForEvent('download'); await page.locator('#downloadTextMidi').click();
  expect(await readFile(await (await next).path())).toEqual(Buffer.from(generateTextMidi('HI 🙂 🦄 ⭐', { mode: 'letter' }).buffer));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__drawingContexts.length)).toBe(0);
});

test('a drawn score sounds through the existing player and edits retain playback', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await stamp(page, 'wave');
  await page.locator('#audioButton').click(); await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await page.locator('#loopSong').check();
  await page.locator('#generateDrawingMidi').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(.3);
  const signal = await sampleAudioEnvelope(page, { durationMs: 600 });
  expect(signal.summary.finite).toBe(true); expect(signal.summary.maxRms).toBeGreaterThan(.002); expect(signal.summary.clippedSamples).toBe(0);
  await page.locator('#drawingModeButton').click(); await stamp(page, 'spiral');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#generateDrawingMidi').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__drawingContexts.length)).toBe(1);
  await page.locator('#audioButton').click();
  await page.locator('#drawingModeButton').click(); await stamp(page, '❤'); await page.locator('#generateDrawingMidi').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeLessThan(.001);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`draw controls and rectangular stage fit ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await open(page); await stamp(page, '🙂');
    for (const id of ['drawingCanvas', 'generateDrawingMidi', 'drawingUndo', 'drawingClear', 'drawingErase']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const bounds = await page.locator(`#${id}`).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(await page.locator('#visualViewport').evaluate(node => getComputedStyle(node).borderRadius)).toBe('0px');
    await page.locator('#drawingModeButton').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('drawing-controls.png') });
    await page.locator('#drawingCanvas').screenshot({ path: testInfo.outputPath('drawing-score.png') });
  });
}
