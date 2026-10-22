import { test, expect } from '@playwright/test';

test('Rig-a-Jig mocap humanoid loads bones, lists clips, and plays real mocap', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  // Choose the mocap rig from the dropdown.
  await page.locator('#rigSelect').selectOption('mocap');
  await expect(page.locator('#rigName')).toContainText('Mocap humanoid');
  await expect(page.locator('#clipRow')).toBeVisible();

  // Wait for the GLB to load and populate the clip dropdown.
  await page.waitForFunction(() =>
    document.getElementById('clipSelect').options.length > 40, { timeout: 15000 });
  const clipCount = await page.locator('#clipSelect option').count();
  expect(clipCount).toBeGreaterThan(40);
  await expect(page.locator('#clipSelect')).toContainText('Dance Loop');

  // The rig has 65 bones and renders as laser joints (no meshes/textures).
  const joints = await page.evaluate(() => window.__zooDebug.getState().joints);
  expect(joints).toBeGreaterThanOrEqual(60);
  const stats = await page.evaluate(() => window.__zooDebug.viewer.sceneStats());
  expect(stats.skinnedMeshes).toBe(0);
  expect(stats.textures).toBe(0);
  expect(stats.sprites).toBeGreaterThan(0);

  // Switch to a different clip.
  await page.locator('#clipSelect').selectOption('Jump_Start');
  await page.waitForTimeout(200);

  expect(errors).toEqual([]);
});
