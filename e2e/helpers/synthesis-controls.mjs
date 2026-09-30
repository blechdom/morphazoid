import { expect } from '@playwright/test';

/** Exercise the visible Choose menu while retaining the native select as state evidence. */
export async function choose(page, id, value) {
  const select = page.locator('#' + id);
  const index = await select.evaluate((node, expected) => [...node.options].findIndex(option => option.value === expected), String(value));
  expect(index, `${id} has option ${value}`).toBeGreaterThanOrEqual(0);
  const picker = page.locator(`[data-select-id="${id}"]`);
  if (!await picker.evaluate(node => node.open)) await picker.locator('summary').click();
  await picker.locator('.instrument-picker-search-input').fill('');
  await picker.locator(`[data-option-index="${index}"]`).click();
  await expect(select).toHaveValue(String(value));
}

/** Exact entry is an intentional secondary gesture beneath each rotary control. */
export async function exact(page, selector, value) {
  const input = typeof selector === 'string' ? page.locator(selector) : selector;
  if (!await input.isVisible()) await input.locator('..').locator('.synthesis-knob-value').click();
  await input.fill(String(value));
  await input.press('Tab');
}
