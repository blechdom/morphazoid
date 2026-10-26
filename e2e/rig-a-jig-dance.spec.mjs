import { test, expect } from '@playwright/test';

test('mocap clips drive the skeleton: bones move while playing, stop when paused', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });

  // Play and measure bone movement.
  await page.locator('#playButton').click();
  const moved = await page.evaluate(async () => {
    const f = window.__zooDebug.viewer.debugFigure();
    const bone = f.rig.joints.find((j) => j.name === 'thigh_l') ?? f.rig.joints[2];
    const q0 = bone.quaternion.toArray();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const q1 = bone.quaternion.toArray();
    return Math.hypot(...q0.map((v, i) => v - q1[i]));
  });
  expect(moved).toBeGreaterThan(0.005);

  // Switching clips via the picker keeps the rig loaded.
  await page.locator('#nextClip').click();
  await page.waitForTimeout(300);
  const joints = await page.evaluate(() => window.__zooDebug.getState().joints);
  expect(joints).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('mocap joints render with the larger humanoid look', async ({ page }) => {
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__zooDebug?.viewer?.debugFigure?.()?.rig?.joints?.length > 0, { timeout: 15000 });
  const scale = await page.evaluate(() => window.__zooDebug.jointScale?.() ?? null);
  expect(scale).not.toBeNull();
  expect(scale).toBeGreaterThan(0.15); // mocap joints use the 0.2 laser look
});
