import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('touch drags cancel cleanly, keyboard undo restores the edit, and rotation preserves playback', async ({ page }) => {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  for (const selector of ['#audioButton', '#playButton']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
  await page.locator('[data-mode="arrange"]').tap();
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = await page.locator('#stage').boundingBox();
  const tile = await page.evaluate(() => window.dominoRun.targets.find(d => d.id === 0));
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + tile.x, y: box.y + tile.y };
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [point]);
  await touch('touchMove', [{ x: point.x + 18, y: point.y - 8 }]);
  await touch('touchCancel', []);
  expect(await page.evaluate(() => window.dominoRun.snapshot.edits)).toEqual([]);
  await touch('touchStart', [point]);
  await touch('touchMove', [{ x: point.x + 18, y: point.y - 8 }]);
  await touch('touchEnd', []);
  expect(await page.evaluate(() => window.dominoRun.snapshot.edits.length)).toBe(1);
  // Chromium suppresses synthetic tap clicks after raw CDP drag gestures.
  // Keep the touch drag/cancel checks separate from native keyboard recovery.
  const summary = page.locator('.group summary').filter({ hasText: 'Selected domino' });
  await summary.press('Enter');
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  await page.locator('#undoEdit').press('Enter');
  expect(await page.evaluate(() => window.dominoRun.snapshot.edits)).toEqual([]);
  await page.locator('#playButton').press('Enter');
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => window.dominoRun.playing)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await cdp.detach();
});
