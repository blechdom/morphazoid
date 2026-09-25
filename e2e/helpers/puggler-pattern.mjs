// Exercise the visible Choose-style view, not the hidden native state handle.
export async function choosePugglerPattern(page, value) {
  const picker = page.locator('.puggler-pattern-picker');
  if (!await picker.evaluate(node => node.open)) await picker.locator('summary').click();
  await picker.locator(`[data-pattern="${value}"]`).click();
}
