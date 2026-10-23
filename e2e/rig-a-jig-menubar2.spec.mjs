import { test, expect } from '@playwright/test';

test('Rig-a-Jig uses the standard menubar, circle play/tempo, and defaults to humanoid', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  // Standard static audio-strip menubar (matches other instruments).
  await expect(page.locator('.masthead .audio-strip')).toBeVisible();
  await expect(page.locator('#audioButton')).toBeVisible();
  await expect(page.locator('#audioState')).toHaveText('off');
  await expect(page.locator('.masthead .header-level input')).toBeVisible();
  // Choose picker disclosure is built by nav.js.
  await expect(page.locator('.masthead .tabs details').first()).toBeVisible();

  // Defaults to the mocap humanoid rig.
  await expect(page.locator('#rigName')).toContainText('Mocap humanoid');
  await expect(page.locator('#rigSelect')).toHaveValue('mocap');
  await expect(page.locator('#clipRow')).toBeVisible();

  // Circle play button (not a text "Play" button) + tempo next to it.
  await expect(page.locator('#playButton.play-button')).toBeVisible();
  const transportDisplay = await page.locator('#playButton .transport-play').evaluate(
    (el) => getComputedStyle(el).display);
  expect(transportDisplay).not.toBe('none');
  await expect(page.locator('#rateInput')).toBeVisible();

  // Starts paused; pressing Play starts the dance loop.
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');

  expect(errors).toEqual([]);
});
