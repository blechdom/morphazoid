import { test, expect } from '@playwright/test';

async function open(page, fallback = false) {
  await page.route('**/blech-art-sources-test.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>canvas{max-width:100%}</style></head><body><details id="art" open></details></body></html>' }));
  await page.addInitScript(() => { globalThis.__artContexts = []; const Native = AudioContext; globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __artContexts.push(this); } }; });
  await page.goto('/blech-art-sources-test.html');
  await page.evaluate(async fallback => {
    const { mountMidiArtCreator } = await import('/src/instruments/blech-midi/blech-midi-art-controls.js');
    const { encodeArtwork } = await import('/src/instruments/blech-midi/blech-midi-art.js');
    globalThis.__artPrepared = []; globalThis.__artSent = []; globalThis.__artSources = [];
    globalThis.__artDrawing = encodeArtwork([{ note: 48, beat: 0, duration: 1, velocity: 90 }], { durationBeats: 4 });
    globalThis.__artStamp = encodeArtwork([{ note: 72, beat: 2, duration: 1, velocity: 110 }], { durationBeats: 4 });
    globalThis.__art = mountMidiArtCreator(document.querySelector('#art'), {
      getDrawingScore: () => __artDrawing,
      getSourceScore: fallback ? undefined : source => { __artSources.push(source); return source === 'stamp' ? __artStamp : __artDrawing; },
      onPrepare: prepared => __artPrepared.push(prepared), onSend: (score, settings) => __artSent.push({ score, settings }),
    });
  }, fallback);
}

test('Scripts copies a chosen drawing or stamp, preserves layered sources and prepares without sending', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => __artPrepared[0].score)).toBeNull();
  await page.evaluate(() => __art.setMode('scripts'));
  await expect(page.locator('#artImage')).toBeHidden(); await expect(page.locator('#artSource')).toBeVisible();
  await expect(page.locator('#artSource')).toHaveValue('drawing');
  await page.locator('#artUseDrawing').click();
  await page.locator('#artSource').selectOption('stamp'); await page.locator('#artUseDrawing').click();
  await expect(page.locator('#artPreview')).toHaveAttribute('data-layers', '2');
  expect(await page.evaluate(() => __artSources)).toEqual(['drawing', 'stamp']);
  expect(await page.evaluate(() => __art.getScore().analysis.notes.map(n => n.note))).toEqual([48, 72]);
  await page.locator('#artScript').selectOption('mirror-pitch');
  await expect.poll(() => page.evaluate(() => __artPrepared.at(-1).score?.analysis.notes.map(n => n.note))).toEqual([72, 48]);
  await page.locator('#artLoop').check();
  const snapshot = await page.evaluate(() => {
    const count = __artPrepared.length, score = __art.getScore(), settings = __art.getSettings(); score.analysis.notes[0].note = -1;
    return { count, after: __artPrepared.length, settings, original: __artDrawing.analysis.notes[0].note, current: __art.getScore().analysis.notes[0].note, sent: __artSent.length, contexts: __artContexts.length };
  });
  expect(snapshot).toMatchObject({ after: snapshot.count, settings: { name: 'Artwork 2', program: 'original', loop: true }, original: 48, current: 72, sent: 0, contexts: 0 });
  await page.locator('#artClear').click();
  expect(await page.evaluate(() => ({ score: __artPrepared.at(-1).score, error: Boolean(__artPrepared.at(-1).error) }))).toEqual({ score: null, error: true });
});

test('Images and Scripts share the image without copying it again; legacy drawing provider still works', async ({ page }) => {
  await open(page, true);
  await page.locator('#artUseDrawing').click();
  expect(await page.evaluate(() => __art.getScore().analysis.notes[0].note)).toBe(48);
  await page.locator('#artClear').click();
  await page.evaluate(() => __art.setMode('images'));
  await expect(page.locator('#artImage')).toBeVisible(); await expect(page.locator('#artSource')).toBeHidden();
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; canvas.getContext('2d').fillRect(0, 0, 2, 2); return canvas.toDataURL().split(',')[1]; });
  await page.locator('#artImage').setInputFiles({ name: 'image-source.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.locator('#artPreview')).toHaveAttribute('data-layers', '1');
  const before = await page.evaluate(() => __art.getScore().analysis.noteCount);
  await page.evaluate(() => __art.setMode('scripts'));
  await page.locator('#artSource').selectOption('image');
  await page.locator('#artUseDrawing').click(); await page.locator('#artUseDrawing').click();
  await expect(page.locator('#artPreview')).toHaveAttribute('data-layers', '1');
  expect(await page.evaluate(() => __art.getScore().analysis.noteCount)).toBe(before);
  await page.locator('#artLayers input').uncheck(); await expect(page.locator('#artPreview')).toHaveAttribute('data-notes', '0');
  await page.locator('#artUseDrawing').click();
  expect(await page.evaluate(() => __art.getScore().analysis.noteCount)).toBe(before);
  expect(await page.evaluate(() => ({ sent: __artSent.length, contexts: __artContexts.length }))).toEqual({ sent: 0, contexts: 0 });
  await page.evaluate(() => __art.dispose()); await expect(page.locator('#art')).toBeEmpty();
});
