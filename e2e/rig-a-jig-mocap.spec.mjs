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

  // Procedural motion menu is hidden for mocap (it has its own transport).
  await expect(page.locator('#motionRow')).toBeHidden();

  // Transport: Play/Pause toggles.
  await expect(page.locator('#playButton')).toHaveText('Pause');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveText('Play');
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveText('Pause');

  // Clip speed + scrub controls exist and update readouts.
  await page.locator('#clipSpeed').fill('1.5');
  await expect(page.locator('#clipSpeedOut')).toHaveText('1.50');
  await page.locator('#clipScrub').fill('0.5');
  await expect(page.locator('#clipScrubOut')).toHaveText('50%');

  // The humanoid actually animates: the mixer's clock advances and a bone moves.
  await page.waitForFunction(() => {
    const f = window.__zooDebug?.viewer?.debugFigure?.();
    return Boolean(f?.rig?.joints?.some?.((j) => j.name === 'thigh_l'));
  }, { timeout: 15000 });
  const moved = await page.evaluate(async () => {
    const f = window.__zooDebug.viewer.debugFigure();
    const bone = f.rig.joints.find((j) => j.name === 'thigh_l');
    const before = bone.quaternion.toArray();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const after = bone.quaternion.toArray();
    return Math.hypot(...before.map((v, i) => v - after[i]));
  });
  expect(moved, 'mocap bone should move while the clip plays').toBeGreaterThan(0.01);

  // Switch to a different clip.
  await page.locator('#clipSelect').selectOption('Jump_Start');
  await page.waitForTimeout(200);

  expect(errors).toEqual([]);
});
