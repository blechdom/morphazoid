import { test, expect } from '@playwright/test';

const state = (page) => page.evaluate(() => window.__trackazoid.snapshot());
async function ready(page) {
  await page.goto('/trackazoid.html');
  await expect(page.locator('#trackazoid')).toHaveAttribute('data-ready', 'true');
}
async function demos(page) {
  await page.locator('#demoPair').click();
  await expect(page.locator('#bState')).toHaveText('READY');
}
function wav() {
  const bytes = Buffer.alloc(16044);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16000, 40);
  for (let i = 0; i < 8000; i++) bytes.writeInt16LE(Math.round(Math.sin(i * .17) * 5000), 44 + i * 2);
  return bytes;
}
async function drop(page, name) {
  const transfer = await page.evaluateHandle(({ name, bytes }) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], name, { type: 'audio/wav', lastModified: 1 }));
    return data;
  }, { name, bytes: [...wav()] });
  try { await page.locator('#deckA').dispatchEvent('drop', { dataTransfer: transfer }); }
  finally { await transfer.dispose(); }
}

test('a delayed earlier file drop cannot supersede a newer deck selection', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const { TrackLibrary } = await import('/src/instruments/trackazoid/library.js');
    const original = TrackLibrary.prototype.addFiles;
    TrackLibrary.prototype.addFiles = async function(files, ...rest) {
      const ids = await original.call(this, files, ...rest);
      if (files[0].name === 'Earlier.wav') await new Promise(resolve => { window.__releaseEarlier = resolve; });
      return ids;
    };
  });
  await drop(page, 'Earlier.wav');
  await page.waitForFunction(() => Boolean(window.__releaseEarlier));
  await drop(page, 'Latest.wav');
  await expect(page.locator('#aTitle')).toHaveText('Latest.wav');
  await expect(page.locator('#aState')).toHaveText('READY');
  await page.evaluate(() => window.__releaseEarlier());
  // Allow promise/animation work from the earlier drop to settle.
  await page.waitForTimeout(100);
  await expect(page.locator('#aTitle')).toHaveText('Latest.wav');
  expect((await state(page)).decks.a.entry).toContain('Latest.wav');
});

test('a failed later decode cannot detach the visible track from the committed audio buffer', async ({ page }) => {
  await ready(page); await demos(page);
  await page.evaluate(async () => {
    const { TrackazoidAudio } = await import('/src/instruments/trackazoid/audio.js');
    const original = TrackazoidAudio.prototype.load;
    TrackazoidAudio.prototype.load = async function(...args) {
      const loaded = original.apply(this, args);
      await new Promise(resolve => { window.__releaseAudioLoad = resolve; });
      return loaded;
    };
  });
  await page.getByRole('button', { name: 'Load Amber circuit — 126 BPM.wav into deck A', exact: true }).click();
  await page.waitForFunction(() => Boolean(window.__releaseAudioLoad));
  await page.locator('#filePicker').setInputFiles({ name: 'Broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') });
  await page.getByRole('button', { name: 'Load Broken.wav into deck A', exact: true }).click();
  await expect(page.locator('#errorMessage')).toContainText('could not be decoded');
  await page.evaluate(() => window.__releaseAudioLoad());
  await expect(page.locator('#aState')).toHaveText('READY');
  await expect(page.locator('#aTitle')).toHaveText('Amber circuit — 126 BPM.wav');
  const snapshot = await state(page);
  expect(snapshot.decks.a.duration).toBeCloseTo(snapshot.decks.b.duration, 5);
  expect(snapshot.decks.a.metadata.bpm).toBe(126);
  expect(snapshot.decks.a.entry).toBe(snapshot.decks.b.entry);
  await page.locator('#aPlay').click();
  expect((await state(page)).decks.a.playing).toBe(true);
});

test('persisted page restoration recovers after pagehide released the audio and UI', async ({ page }) => {
  await ready(page); await demos(page);
  await page.locator('#aPlay').click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect((await state(page)).disposed).toBe(true);
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
  ]);
  await expect(page.locator('#trackazoid')).toHaveAttribute('data-ready', 'true');
  expect((await state(page)).disposed).toBe(false);
  expect((await state(page)).armed).toBe(false);
  await demos(page);
  await page.locator('#aPlay').click();
  expect((await state(page)).decks.a.playing).toBe(true);
});

test('a file dropped during library restoration waits until saved metadata has loaded', async ({ page }) => {
  await ready(page); await drop(page, 'Saved.wav');
  await expect(page.locator('#aState')).toHaveText('READY');
  await page.locator('#aBpm').fill('138');
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('morphazoid-trackazoid-library', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const read = db.transaction('entries', 'readonly').objectStore('entries').getAll();
      read.onsuccess = () => { db.close(); resolve(read.result[0]?.metadata.bpm); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  }))).toBe(138);
  await page.route('**/src/instruments/trackazoid/library.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('async init() {', 'async init() { await new Promise(resolve => { globalThis.__finishRestore = resolve; });');
    await route.fulfill({ response, body });
  });
  await page.reload(); await page.waitForFunction(() => Boolean(window.__finishRestore));
  await expect(page.locator('#openFolder')).toBeDisabled();
  await expect(page.locator('#demoPair')).toBeDisabled();
  await drop(page, 'Saved.wav');
  expect((await state(page)).decks.a.entry).toBeNull();
  await page.evaluate(() => window.__finishRestore());
  await expect(page.locator('#aState')).toHaveText('READY');
  await expect(page.locator('#aBpm')).toHaveValue('138');
  await expect(page.locator('#trackCount')).toHaveText('1 track');
  expect((await state(page)).contextState).toBe('none');
});
