// Original, deterministic Canvas artwork; no external image inputs.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 512, 512);
    bg.addColorStop(0, '#142d36'); bg.addColorStop(1, '#080e17');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#2b444d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(25, 30, 462, 452, 26); ctx.stroke();
    for (const [center, color, phase] of [[145, '#72e1cd', 0], [367, '#f6b57c', 1]]) {
      ctx.fillStyle = '#0b151e'; ctx.beginPath(); ctx.roundRect(center - 94, 58, 188, 102, 10); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let i = 0; i < 43; i++) {
        const x = center - 84 + i * 4;
        const pulse = Math.exp(-(i % 11) / 3.6);
        const amplitude = 4 + 29 * pulse + 8 * Math.abs(Math.sin(i * 1.71 + phase));
        ctx.globalAlpha = .6 + .4 * pulse;
        ctx.beginPath(); ctx.moveTo(x, 109 - amplitude); ctx.lineTo(x, 109 + amplitude); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(center, 263, 87, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      const disc = ctx.createRadialGradient(center - 18, 242, 8, center, 263, 80);
      disc.addColorStop(0, '#283e48'); disc.addColorStop(1, '#080f18');
      ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(center, 263, 80, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#30434c'; ctx.lineWidth = 1;
      for (const r of [43, 52, 61, 70]) { ctx.beginPath(); ctx.arc(center, 263, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(center, 263, 79, -Math.PI * .74, -Math.PI * .19); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(center, 263, 25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101d25'; ctx.beginPath(); ctx.arc(center, 263, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#14242c'; ctx.beginPath(); ctx.roundRect(center - 75, 374, 42, 35, 6); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(center - 59, 383); ctx.lineTo(center - 59, 400); ctx.lineTo(center - 45, 391.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#557079'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.roundRect(center - 20 + i * 31, 378, 23, 27, 4); ctx.stroke(); }
    }
    ctx.strokeStyle = '#34505b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(88, 447); ctx.lineTo(424, 447); ctx.stroke();
    ctx.strokeStyle = '#bad7df'; ctx.lineWidth = 2; ctx.fillStyle = '#142831';
    ctx.beginPath(); ctx.roundRect(237, 430, 38, 34, 5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(256, 437); ctx.lineTo(256, 457); ctx.stroke();
    return canvas.toDataURL('image/webp', .94).split(',')[1];
  });
  await writeFile(new URL('../assets/instruments/trackazoid.webp', import.meta.url), Buffer.from(data, 'base64'));
} finally { await browser.close(); }
