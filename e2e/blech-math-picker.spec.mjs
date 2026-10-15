import { test, expect } from '@playwright/test';

async function openMath(page) {
  await page.route('**/math-picker-qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi-generators.css">
    <link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi.css"></head><body>
    <main id="host" style="width:min(560px,calc(100vw - 32px));margin:16px"></main><button id="outside">Outside</button>
    <script type="module">
      import {mountBlechMath} from '/src/instruments/blech-midi/blech-midi-math-controls.js';
      globalThis.drops=[]; globalThis.prepared=[];
      globalThis.math=mountBlechMath(document.querySelector('#host'),{
        onDrop:score=>drops.push(score), onPrepare:detail=>prepared.push(detail.settings.name),
      });
    </script></body></html>` }));
  await page.goto('/math-picker-qa');
  await expect(page.locator('.blech-math-picker')).toBeVisible();
}

for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`Math previews can be searched and selected silently in ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await openMath(page);
    await expect(page.locator('#blechMathPreset')).toBeHidden();
    await expect(page.locator('.blech-stamp-thumbnail:visible')).toHaveCount(1);
    const trigger = page.locator('.blech-math-picker summary');
    await trigger.click();
    const search = page.getByRole('searchbox', { name: 'Filter math patterns' });
    await expect(search).toBeFocused();
    await search.fill('opening fan');
    await expect(page.locator('.blech-stamp-choice:visible')).toHaveCount(1);
    const bounds = await page.locator('.blech-stamp-picker-panel').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await search.press('Enter');
    await expect(trigger).toBeFocused(); await expect(trigger).toContainText('Opening fan');
    await expect(page.locator('#blechMathPreset')).toHaveValue('opening-fan');
    await expect(page.locator('#blechMathEquation')).toHaveValue('t*sin(6*x)');
    await expect(page.locator('.blech-stamp-thumbnail:visible')).toHaveCount(1);
    expect(await page.evaluate(() => drops.length)).toBe(0);
    expect(await page.evaluate(() => prepared.at(-1))).toBe('Opening fan');
  });
}

test('Math custom edits, native selection, keyboard navigation and disposal keep one state owner', async ({ page }) => {
  await openMath(page);
  const trigger = page.locator('.blech-math-picker summary');
  await page.locator('#blechMathEquation').fill('cos(x)');
  await expect(trigger).toContainText('Custom equation');
  await expect(page.locator('#blechMathPreset')).toHaveValue('custom');
  await page.locator('#blechMathPreset').selectOption('heart', { force: true });
  await expect(trigger).toContainText('Heart attack');
  await expect(page.locator('#blechMathEquationX')).toHaveValue('sin(t)^3');
  await trigger.focus(); await trigger.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Sine blade · Equation', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('button', { name: 'Ribbon knot · Parametric', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click();
  const search = page.getByRole('searchbox', { name: 'Filter math patterns' });
  await search.fill('nonexistent formula');
  await expect(page.getByText('No matching math patterns', { exact: true })).toBeVisible();
  await search.fill('cos(3*t)');
  await expect(page.getByRole('button', { name: 'Epicycle bubble · Parametric', exact: true })).toBeVisible();
  expect(await page.evaluate(() => drops.length)).toBe(0);
  await page.evaluate(() => { math.dispose(); math.dispose(); });
  await expect(page.locator('.blech-math-picker')).toHaveCount(0);
  await expect(page.locator(':popover-open')).toHaveCount(0);
});
