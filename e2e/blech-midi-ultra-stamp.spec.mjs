import { expect, test } from '@playwright/test';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

test('Free Stamp remains selectable and can place repeated one-shot copies', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/blech-midi-ultra.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await page.locator('#blechToolStamp').click();
  await expect(page.locator('#blechToolStamp')).toHaveAttribute('aria-pressed', 'true');
  const surface = page.locator('.blech-spigot-paint');
  const bounds = await surface.boundingBox();
  const layers = page.locator('#blechLiveLayers .blech-live-layer');
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(bounds.x + bounds.width * (.35 + i * .04), bounds.y + bounds.height * .4);
    await expect(layers).toHaveCount(i + 1);
    const ids = await layers.evaluateAll(rows => rows.map(row => row.dataset.sampleId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(seen.has(ids.at(-1))).toBe(false);
    seen.add(ids.at(-1));
    await expect(page.locator('#blechToolStamp')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.blech-spigot-notice')).toBeHidden();
  }
  expect(seen.size).toBe(6, 'each click retains an editable stamp even when there are only four live clip slots');
  expect(Number(await page.locator('#blechMidi').getAttribute('data-samples'))).toBeLessThanOrEqual(4);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('Free Stamp reports what occupies the sound bus if four layers are paused', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/blech-midi-ultra.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await page.locator('#blechDropSend').click();
  await page.locator('#blechToolStamp').click();
  const bounds = await page.locator('.blech-spigot-paint').boundingBox();
  const x = bounds.x + bounds.width * .35, y = bounds.y + bounds.height * .4;
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(x + i * bounds.width * .04, y);
  }
  const layers = page.locator('#blechLiveLayers .blech-live-layer');
  await expect(layers).toHaveCount(4);
  await page.locator('#blechLayersToggle').click();
  for (const row of await layers.all()) {
    await row.locator('[data-layer-pause]').click();
  }
  await expect(layers.locator('[data-layer-pause][aria-pressed="false"]')).toHaveCount(4);
  await page.mouse.click(x + bounds.width * .12, y);
  await expect(layers).toHaveCount(4);
  await expect(page.locator('.blech-spigot-notice')).toHaveText(
    'All four layers are paused. Press Play to resume, or remove a layer before adding another.',
  );
  await layers.first().locator('[data-layer-stop]').click();
  await expect(layers).toHaveCount(3);
  await page.mouse.click(x + bounds.width * .16, y);
  await expect(layers).toHaveCount(4);
  await expect(page.locator('.blech-spigot-notice')).toBeHidden();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
