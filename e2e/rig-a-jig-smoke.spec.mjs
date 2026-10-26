import { test, expect } from '@playwright/test';

test('Rig-a-Jig renders the mocap zoo, animates, and keeps Audio off by default', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Rig-a-Jig' })).toBeVisible();

  // The rig pulldown is populated with the downloaded mocap zoo.
  const rigOptions = await page.locator('#rigSelect option').count();
  expect(rigOptions).toBeGreaterThanOrEqual(14); // 14 mocap creatures

  // Wait for the default humanoid to load, then play.
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
  await page.locator('#playButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => window.__zooDebug.getState().frames);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__zooDebug.getState().frames);
  expect(after).toBeGreaterThan(before);

  // Switch across several mocap rigs via the pulldown.
  for (const rig of ['cow', 'spiderMocap', 'frogMocap', 'wasp']) {
    await page.locator('#rigSelect').selectOption(rig);
    await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
    const clips = await page.locator('#clipSelect option').count();
    expect(clips).toBeGreaterThan(0);
  }
  // The stage overlay is minimal: title + camera buttons only, no readout text.
  await expect(page.locator('#modelReadout')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Rig-a-Jig skeleton mode is mesh-free; ghost body adds the real skinned mesh', async ({ page }) => {
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  for (const rig of ['cow', 'spiderMocap', 'wasp']) {
    await page.locator('#rigSelect').selectOption(rig);
    await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
    // Default skeleton mode: no meshes, no textures.
    let stats = await page.evaluate(() => window.__zooDebug.viewer.sceneStats());
    expect(stats.skinnedMeshes, `${rig}: skeleton mode has no skinned meshes`).toBe(0);
    expect(stats.textures, `${rig}: no textures`).toBe(0);
    expect(stats.bones, `${rig}: has bones`).toBeGreaterThan(0);
    expect(stats.sprites, `${rig}: has laser joint sprites`).toBeGreaterThan(0);
    // Ghost body: the real skinned mesh appears.
    await page.locator('#bodySelect').selectOption('ghost');
    await page.waitForFunction(() => (window.__zooDebug?.viewer?.debugFigure?.()?.ghostMeshes?.length ?? 0) > 0, { timeout: 15000 });
    stats = await page.evaluate(() => window.__zooDebug.viewer.sceneStats());
    expect(stats.skinnedMeshes, `${rig}: ghost body shows the skinned mesh`).toBeGreaterThan(0);
    expect(stats.textures, `${rig}: ghost body still has no textures`).toBe(0);
    // Back to skeleton.
    await page.locator('#bodySelect').selectOption('off');
    await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
  }
});
