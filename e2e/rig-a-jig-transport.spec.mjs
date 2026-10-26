import { test, expect } from '@playwright/test';

test('Rig-a-Jig has rig + clip pickers, Play/Pause, and tempo', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });

  // Rig pulldown with grouped mocap options.
  const rigOptions = await page.locator('#rigSelect option').count();
  expect(rigOptions).toBeGreaterThanOrEqual(14);

  // Clip picker is populated from the rig's real clips.
  const clips = await page.locator('#clipSelect option').count();
  expect(clips).toBeGreaterThan(0);

  // Circle Play/Pause toggles via aria-pressed.
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');

  // Tempo slider exists and updates its readout.
  await page.locator('#rateInput').fill('1.2');
  await expect(page.locator('#rateOut')).toHaveText('1.20×');

  // Pick a different rig from the pulldown.
  await page.locator('#rigSelect').selectOption('cow');
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
  await expect(page.locator('#rigName')).toContainText('Cow');

  // The dice stepper lands on a valid rig (never throws).
  await page.locator('#diceRig').click();
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
  const joints = await page.evaluate(() => window.__zooDebug.getState().joints);
  expect(joints).toBeGreaterThan(2);

  expect(errors).toEqual([]);
});
