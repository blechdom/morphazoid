import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { readAudioStatus } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.addInitScript(() => { globalThis.__artContexts = []; const Native = AudioContext; globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __artContexts.push(this); } }; });
  await page.goto('/blech-midi.html');
  await frameTab(page, 'art');
}
async function frameTab(page, id) {
  await page.locator('#blechTab-frames').click(); await page.locator(`#blechTab-${id}`).click();
  await expect(page.locator(`#blechPanel-${id === 'scripts' ? 'art' : id}`)).toBeVisible();
}
async function field(page, id, value) { await page.locator(`#art${id}`).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
async function exported(page) { const pending = page.waitForEvent('download'); await page.locator('#artExport').click(); return parseMidi(await readFile(await (await pending).path())); }
async function upload(page) {
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 4, 4); ctx.fillStyle = 'black'; ctx.fillRect(0, 0, 2, 2); ctx.fillRect(2, 2, 2, 2); return canvas.toDataURL().split(',')[1]; });
  await page.locator('#artImage').setInputFiles({ name: 'diagonal.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
}

test('image exports exact full-range geometry, layers overlap and their toggles alter MIDI', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  await field(page, 'Width', 4); await field(page, 'Height', 4); await upload(page);
  await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '4');
  let score = await exported(page);
  expect(score.notes.map(n => [n.note, n.beat, n.duration])).toEqual([[85, 0, 4], [127, 0, 4], [0, 4, 4], [42, 4, 4]]);
  await upload(page); await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '8');
  score = await exported(page); expect(score.trackCount).toBe(2); expect(score.noteCount).toBe(8);
  await page.locator('#artLayers input').first().uncheck();
  await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '4');
  expect((await exported(page)).noteCount).toBe(4);
  expect(await page.evaluate(() => __artContexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect(errors).toEqual([]);
});

test('copy drawing, seeded scripts and curves create reusable independently looping pads', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await frameTab(page, 'drawing');
  await page.getByRole('button', { name: 'Heart stamp', exact: true }).click();
  await frameTab(page, 'scripts'); await page.locator('#artSource').selectOption('drawing');
  await page.locator('#artUseDrawing').click();
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const original = await exported(page);
  await page.locator('#artScript').selectOption('scatter'); await field(page, 'Seed', 7);
  const a = await exported(page), b = await exported(page); expect(a.notes).toEqual(b.notes); expect(a.notes).not.toEqual(original.notes);
  await field(page, 'Seed', 8); expect((await exported(page)).notes).not.toEqual(a.notes);
  await page.locator('#artScript').selectOption('none'); await page.locator('.blech-art-settings > summary').last().click(); await page.locator('#artPitchCurve').selectOption('rise'); await field(page, 'PitchDepth', 12);
  const curved = await exported(page); expect(curved.notes.map(n => n.note)).not.toEqual(original.notes.map(n => n.note));
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
  await frameTab(page, 'stamps');
  await expect(page.locator('#mixerSavedPads [data-saved-pad]')).toHaveCount(1);
  await expect(page.locator('#mixerSavedPads [data-pad-loop]')).toBeChecked();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1');
  expect(await page.evaluate(() => __artContexts.length)).toBe(0);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  await frameTab(page, 'scripts');
  await page.locator('#artClear').click(); await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '0');
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1');
  await frameTab(page, 'stamps');
  await page.locator('#mixerSavedPads [data-pad-play]').click(); await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) test(`creator controls remain reachable at ${viewport.width} × ${viewport.height}`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport); await open(page); await page.locator('#artScript').selectOption('sine');
  await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '64');
  for (const summary of await page.locator('.blech-art-settings > summary').all()) await summary.click();
  await page.locator('#artGateCurve').selectOption('fall'); await field(page, 'GateDepth', .5);
  await expect(page.locator('#artExport')).toBeEnabled();
  const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, nested: [...document.querySelectorAll('.blech-art-body, .blech-art-controls')].map(node => node.scrollWidth - node.clientWidth) }));
  expect(overflow.page).toBeLessThanOrEqual(1); expect(Math.max(...overflow.nested)).toBeLessThanOrEqual(1);
  await page.locator('#artPreview').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('creator.png') });
  expect((await exported(page)).noteCount).toBe(64);
});
