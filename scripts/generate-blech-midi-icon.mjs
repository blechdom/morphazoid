// Render the page's authored bat/MIDI SVG as the catalogue's square WebP.
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
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050709';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#ffffff07';
    ctx.lineWidth = 1;
    for (let pos = .5; pos < 512; pos += 32) {
      ctx.beginPath();
      ctx.moveTo(pos, 0); ctx.lineTo(pos, 512);
      ctx.moveTo(0, pos); ctx.lineTo(512, pos);
      ctx.stroke();
    }
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
