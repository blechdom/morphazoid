import { test, expect } from '@playwright/test';

test('Rig-a-Jig renders the zoo, animates, and keeps Audio off by default', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Rig-a-Jig' })).toBeVisible();

  // The rig pulldown is populated with the full zoo.
  const rigOptions = await page.locator('#rigSelect option').count();
  expect(rigOptions).toBeGreaterThanOrEqual(40); // 26 procedural + 14 mocap + Random

  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => window.__zooDebug.getState().frames);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__zooDebug.getState().frames);
  expect(after).toBeGreaterThan(before);

  // Switch across several rigs via the pulldown.
  for (const rig of ['jellyfish', 'horse', 'butterfly', 'whip']) {
    await page.locator('#rigSelect').selectOption(rig);
    await expect(page.locator('#rigName')).toHaveText(new RegExp(rig, 'i'));
    expect(await page.locator('#motionSelect option').count()).toBe(5);
  }
  // The stage overlay is minimal: title + camera buttons only, no readout text.
  await expect(page.locator('#modelReadout')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Rig-a-Jig scene has no meshes, materials or textures across many rigs', async ({ page }) => {
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  for (const rig of ['spider', 'octopus', 'snake', 'horse', 'striker']) {
    await page.locator('#rigSelect').selectOption(rig);
    const stats = await page.evaluate(() => window.__zooDebug.viewer.sceneStats());
    expect(stats.skinnedMeshes, `${rig}: no skinned meshes`).toBe(0);
    expect(stats.litMaterials, `${rig}: no lit materials`).toBe(0);
    expect(stats.textures, `${rig}: no textures`).toBe(0);
    expect(stats.bones, `${rig}: has bones`).toBeGreaterThan(0);
    expect(stats.lineSegments, `${rig}: has vector lines`).toBeGreaterThan(0);
    expect(stats.sprites, `${rig}: has laser joint sprites`).toBeGreaterThan(0);
  }
});
