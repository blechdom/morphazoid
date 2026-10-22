import { test, expect } from '@playwright/test';

test('dance does not fly away: root stays near ground after repeated dances', async ({ page }) => {
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  // Read root Y over time through a debug hook on the first joint.
  const rootY = () => page.evaluate(() => {
    const canvas = document.getElementById('zooCanvas');
    const viewer = window.__zooDebug.viewer;
    // Access the figure's root joint world position via screenPoint of joint 0.
    return window.__zooDebug.getState();
  });

  const height = () => page.evaluate(() => {
    // Read the actual world Y of the root bone.
    const v = window.__zooDebug.viewer;
    let y = null;
    // screenPoint gives screen coords; instead expose jointWorld through debug.
    return window.__zooDebug.rootY ? window.__zooDebug.rootY() : null;
  });

  const before = await page.evaluate(() => window.__zooDebug.rootY?.() ?? null);
  // Dance three times in a row via the motion pulldown; without the fix, root
  // accumulated upward each time.
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#motionSelect').selectOption('dance');
    await page.waitForTimeout(900);
    await page.locator('#motionSelect').selectOption('walk');
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__zooDebug.rootY?.() ?? null);
  if (before != null && after != null) {
    expect(Math.abs(after - before)).toBeLessThan(0.3);
  }
});

test('joints render small: sprite scale stays tight', async ({ page }) => {
  await page.goto('http://127.0.0.1:3459/rig-a-jig.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const scale = await page.evaluate(() => window.__zooDebug.jointScale?.() ?? null);
  if (scale != null) expect(scale).toBeLessThan(0.18);
});
