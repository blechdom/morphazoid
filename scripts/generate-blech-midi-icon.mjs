// Render the page's authored red bat/MIDI SVG as a transparent catalogue WebP.
// Midiophilia keeps the original heart WebP from BLECH MIDI, without re-encoding.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const mark = await readFile(new URL('../assets/blech-midi/blech-mark.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const data = await page.evaluate(async svg => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    // The mark belongs directly on each instrument's surface. Keep the
    // surrounding space and the MIDI socket opening genuinely transparent.
    const ctx = canvas.getContext('2d', { alpha: true });
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    ctx.drawImage(img, 16, 116, 480, 280);
    return canvas.toDataURL('image/webp', .98).split(',')[1];
  }, mark);
  await writeFile(new URL('../assets/instruments/blech-midi.webp', import.meta.url), Buffer.from(data, 'base64'));
} finally {
  await browser.close();
}
