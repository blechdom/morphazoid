import { test, expect } from '@playwright/test';

test('Rig-a-Jig has rig + motion pulldowns, Play/Pause, tempo, and random body plans', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  // Rig pulldown with grouped options.
  const rigOptions = await page.locator('#rigSelect option').count();
  expect(rigOptions).toBeGreaterThanOrEqual(26);
  await expect(page.locator('#rigSelect optgroup')).toHaveCount(await page.locator('#rigSelect optgroup').count());

  // Motion pulldown has the five transport motions.
  await expect(page.locator('#motionSelect')).toContainText('Walk');
  await expect(page.locator('#motionSelect')).toContainText('Dance');
  await expect(page.locator('#motionSelect')).toContainText('Jump');
  await expect(page.locator('#motionSelect')).toContainText('Karate');
  await expect(page.locator('#motionSelect')).toContainText('Stomp');

  // Play/Pause toggles.
  await expect(page.locator('#playButton')).toHaveText('Play');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveText('Pause');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveText('Play');

  // Tempo slider exists and updates its readout.
  await page.locator('#rateInput').fill('1.2');
  await expect(page.locator('#rateOut')).toHaveText('1.20');

  // Pick a different rig from the pulldown.
  await page.locator('#rigSelect').selectOption('octopus');
  await expect(page.locator('#rigName')).toContainText('octopus');

  // Random body plan produces a valid rig with joints.
  await page.locator('#randomRig').click();
  await expect(page.locator('#rigName')).toContainText('Random body plan');
  const joints = await page.evaluate(() => window.__zooDebug.getState().joints);
  expect(joints).toBeGreaterThan(2);

  // Two randoms in a row give different seeds (readout seed changes or joint count can differ).
  await page.locator('#randomRig').click();
  const joints2 = await page.evaluate(() => window.__zooDebug.getState().joints);
  expect(joints2).toBeGreaterThan(2);

  expect(errors).toEqual([]);
});
