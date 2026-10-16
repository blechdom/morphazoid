import { test, expect } from '@playwright/test';

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__resizeQA = { stages: [], contexts: 0, drops: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __resizeQA.contexts++; } };
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-drop-stage.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('export function mountBlechDropStage(', 'function originalMountBlechDropStage(');
    await route.fulfill({ response, body: `${body}\nexport function mountBlechDropStage(host,viewport,options){const stage=originalMountBlechDropStage(host,viewport,{...options,onDrop:(score,settings)=>{__resizeQA.drops.push({analysis:score.analysis,settings});return options.onDrop(score,settings);}});__resizeQA.stages.push(stage);return stage;}` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechDropWidth')).toBeAttached();
  await page.locator('#blechTab-math').click();
  await expect(page.locator('.blech-drop-overlay')).toBeVisible();
}
async function number(page, id, value) {
  await page.locator(`#${id}`).fill(String(value));
  await page.locator(`#${id}`).press('Tab');
}
async function prepared(page) {
  return page.evaluate(() => ({ settings: __resizeQA.stages[0].getSettings(), analysis: __resizeQA.stages[0].getPreparedScore().analysis }));
}
async function remainsSilent(page) {
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __resizeQA.contexts)).toBe(0);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
}

test('prepared size edits stay silent and drop the complete matching score with its chosen sound', async ({ page }) => {
  await open(page);
  const original = await prepared(page);
  await number(page, 'blechDropWidth', 17); await number(page, 'blechDropHeight', 4);
  await page.locator('#blechDropChannel').selectOption({ value: '6' }); await page.locator('#blechDropProgram').selectOption({ value: '4' });
  await page.locator('#blechDropGain').evaluate(node => { node.value = '.42'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  const resized = await prepared(page), pitches = resized.analysis.notes.map(note => note.note);
  expect(resized.analysis.noteCount).toBe(original.analysis.noteCount);
  expect(Math.max(...pitches) - Math.min(...pitches) + 1).toBe(17);
  expect(resized.analysis.durationBeats).toBe(4);
  await expect(page.locator('.blech-drop-overlay')).toHaveAttribute('data-width-notes', '17');
  await expect(page.locator('.blech-drop-overlay')).toHaveAttribute('data-height-beats', '4');
  await remainsSilent(page);
  await page.locator('#blechDropSend').click();
  const dropped = await page.evaluate(() => __resizeQA.drops.at(-1));
  expect(dropped.analysis.notes).toEqual(resized.analysis.notes);
  expect(dropped.settings).toMatchObject({ channel: 6, program: '4', gain: .42, widthNotes: 17, heightBeats: 4 });
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('edge and corner drags resize the block while arrows retain exact keyboard control', async ({ page }) => {
  await open(page); await number(page, 'blechDropWidth', 25); await number(page, 'blechDropHeight', 4);
  const edge = page.locator('[data-resize="right"]');
  await edge.focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#blechDropWidth')).toHaveValue('24');
  const top = page.locator('[data-resize="top"]'); await top.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#blechDropHeight')).toHaveValue('3.75');
  const before = await prepared(page), corner = page.locator('[data-resize="bottom-right"]'), box = await corner.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 10, { steps: 4 }); await page.mouse.up();
  const after = await prepared(page);
  expect(after.settings.widthNotes).toBeGreaterThan(before.settings.widthNotes);
  expect(after.settings.heightBeats).toBeGreaterThan(before.settings.heightBeats);
  expect(after.settings.delayBeats).toBeLessThan(before.settings.delayBeats);
  expect(after.analysis.noteCount).toBe(before.analysis.noteCount);
  await remainsSilent(page);
  await page.locator('#blechDropReset').click();
  expect((await prepared(page)).settings).toMatchObject({ widthNotes: null, heightBeats: null, transpose: 0, delayBeats: 2 });
});

test('block sizes are kept per generator and preparation leaves existing layers intact', async ({ page }) => {
  await open(page); await number(page, 'blechDropWidth', 19); await number(page, 'blechDropHeight', 3);
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
  const dropped = await page.evaluate(() => __resizeQA.drops[0]);
  await page.locator('#blechTab-frames').click();
  await expect(page.locator('#blechDropWidth')).not.toHaveValue('19');
  await number(page, 'blechDropWidth', 31); await number(page, 'blechDropHeight', 6);
  await page.locator('#blechTab-math').click();
  await expect(page.locator('#blechDropWidth')).toHaveValue('19'); await expect(page.locator('#blechDropHeight')).toHaveValue('3');
  await page.locator('#blechTab-frames').click();
  await expect(page.locator('#blechDropWidth')).toHaveValue('31'); await expect(page.locator('#blechDropHeight')).toHaveValue('6');
  expect(await page.evaluate(() => __resizeQA.drops)).toEqual([dropped]);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1');
});

for (const [name, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`numeric resize controls stay reachable in ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page);
    await number(page, 'blechDropWidth', 23); await number(page, 'blechDropHeight', 2);
    await page.locator('#blechDropHeight').scrollIntoViewIfNeeded();
    await expect(page.locator('#blechDropHeight')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await remainsSilent(page);
  });
}
