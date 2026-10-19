import { expect, test } from '@playwright/test';

test('Rig Lab appears in Work in Progress as one lab and opens its downloaded models', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const wip = page.locator('.catalogue-group[data-category-id="wip"]');
  const card = wip.locator('.instrument-card[data-instrument-id="rig-lab"]');
  await expect(card).toHaveAttribute('data-entry-type', 'lab');
  await expect(card.locator('a')).toHaveAttribute('href', 'rig-lab.html');
  await card.locator('a').click();
  await expect(page).toHaveURL(/\/rig-lab\.html$/);
  await expect(page.getByRole('heading', { name: 'Rig Lab' })).toBeVisible();
  await page.waitForFunction(() =>
    window.rigLabDemo?.state().visual.downloaded.models['ant-farm'].status === 'ready');
  await expect(page.locator('#assetStatus')).toContainText('Downloaded ants only');
  expect(errors).toEqual([]);
});
