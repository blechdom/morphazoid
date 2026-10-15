import { test, expect } from '@playwright/test';

async function openPicker(page) {
  await page.route('**/stamp-picker-qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi.css"></head><body>
    <main id="host" style="width:min(320px,calc(100vw - 32px));margin:16px"></main><button id="outside">Outside</button>
    <script type="module">
      import {mountBlechStampPicker} from '/src/instruments/blech-midi/blech-midi-stamp-picker.js';
      const notes=[{note:48,beat:0,duration:1},{note:72,beat:1,duration:1}];
      globalThis.choices=[];
      globalThis.entries=[{id:'heart',title:'Heart',group:'Shapes',notes,durationBeats:2},
        {id:'plaid',title:'Plaid',group:'Patterns',notes,durationBeats:2},
        {id:'file',title:'Geometric rain',group:'Black MIDI',file:'rain.mid'}];
      globalThis.picker=mountBlechStampPicker(document.querySelector('#host'),{entries,onSelect:id=>choices.push(id)});
    </script></body></html>` }));
  await page.goto('/stamp-picker-qa');
  await expect(page.locator('.blech-stamp-picker')).toBeVisible();
}

for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`stamp menu shows one selected preview, searches and stays reachable in ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await openPicker(page);
    await expect(page.locator('.blech-stamp-thumbnail:visible')).toHaveCount(1);
    const trigger = page.locator('.blech-stamp-picker summary');
    await trigger.click();
    const search = page.getByRole('searchbox', { name: 'Filter MIDI stamps' });
    await expect(search).toBeFocused();
    await search.fill('black rain');
    await expect(page.locator('.blech-stamp-choice:visible')).toHaveCount(1);
    const bounds = await page.locator('.blech-stamp-picker-panel').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
    await search.press('Enter');
    await expect(trigger).toBeFocused(); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toContainText('Geometric rain');
    await expect(page.locator('.blech-stamp-thumbnail:visible')).toHaveCount(1);
    expect(await page.evaluate(() => choices)).toEqual(['file']);
  });
}

test('stamp keyboard navigation, external selection, catalogue refresh and disposal preserve ownership', async ({ page }) => {
  await openPicker(page);
  const trigger = page.locator('.blech-stamp-picker summary');
  await trigger.focus(); await trigger.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Heart · Shapes' })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('button', { name: 'Geometric rain · Black MIDI' })).toBeFocused();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => choices)).toEqual(['plaid']);
  await page.evaluate(() => { picker.select('heart'); picker.update([...entries, {id:'new',title:'New shape'}]); });
  await expect(trigger).toContainText('Heart'); expect(await page.evaluate(() => choices)).toEqual(['plaid']);
  await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await page.locator('#outside').click(); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => { picker.dispose(); picker.dispose(); picker.update(entries); });
  await expect(page.locator('.blech-stamp-picker')).toHaveCount(0);
  await expect(page.locator(':popover-open')).toHaveCount(0);
});
