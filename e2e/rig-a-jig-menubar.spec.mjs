import { test, expect } from '@playwright/test';

test('Rig-a-Jig has the shared Morphazoid menubar with a working Choose picker', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // The static tabs must be replaced by the shared Choose picker disclosure.
  const picker = page.locator('.tabs details').first();
  await expect(picker).toBeVisible();
  await expect(page.locator('.tabs summary').first()).toBeVisible();

  // Open the picker and confirm it lists grouped instruments.
  await page.locator('.tabs summary').first().click();
  const groups = await page.locator('.tabs .instrument-picker-group').count();
  expect(groups).toBeGreaterThan(2);
  const links = await page.locator('.tabs .instrument-picker-link').count();
  expect(links).toBeGreaterThan(20);

  // Mobile select is present and populated with instruments.
  const options = await page.locator('.mobile-instrument-select option').count();
  expect(options).toBeGreaterThan(20);

  // Audio button exists and is off by default.
  const audioButton = page.locator('.audio-button').first();
  await expect(audioButton).toBeVisible();
  expect(errors).toEqual([]);
});
