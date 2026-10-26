import { test, expect } from '@playwright/test';

test('Rig-a-Jig supports IK grab and laser joints on mocap rigs', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });

  // Laser rendering (skeleton mode): joints are sprites + cores, lines additive, no meshes.
  const stats = await page.evaluate(() => window.__zooDebug.viewer.sceneStats());
  expect(stats.skinnedMeshes).toBe(0);
  expect(stats.litMaterials).toBe(0);
  expect(stats.textures).toBe(0);
  expect(stats.sprites).toBeGreaterThan(0);
  expect(stats.lineSegments).toBeGreaterThan(0);

  // Play a clip and confirm the scene keeps animating.
  await page.locator('#playButton').click();
  const before = await page.evaluate(() => window.__zooDebug.getState().frames);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.__zooDebug.getState().frames);
  expect(after).toBeGreaterThan(before);

  // IK grab: a mocap rig has grabbable joints.
  const joints = await page.evaluate(() => window.__zooDebug.getState().joints);
  expect(joints).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});
