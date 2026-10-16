import { test, expect } from '@playwright/test';

async function open(page) {
  await page.addInitScript(() => { globalThis.__layerEditorQA = {}; });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst editorVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){__layerEditorQA.engine=this;return editorVolume.apply(this,args);};` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-spigot-engine.js', async route => {
    const response = await route.fetch(), code = (await response.text()).replace('export function createBlechSpigotEngine(', 'function editorCreateBlechSpigotEngine(');
    await route.fulfill({ response, body: `${code}\nexport function createBlechSpigotEngine(options){__layerEditorQA.sources=editorCreateBlechSpigotEngine(options);return __layerEditorQA.sources;}` });
  });
  await page.goto('/blech-midi.html'); await expect(page.locator('#blechDropSend')).toBeEnabled();
}
async function number(page, selector, value) { await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab'); }
async function pair(page) {
  await number(page, '#blechDropWidth', 25); await number(page, '#blechDropHeight', 64); await number(page, '#blechDropDelay', 0);
  await page.locator('#blechDropLoop').click();
  await page.locator('#blechDropSend').click(); await page.locator('#blechDropSend').click();
  await expect(page.locator('.blech-live-layer')).toHaveCount(2);
  return page.evaluate(() => __layerEditorQA.sources.getLayers().map(source => source.id));
}
const row = (page, id) => page.locator(`.blech-live-layer[data-spigot-id="${id}"]`);
const editor = page => page.locator('#blechLayerEditor');
const sourceState = page => page.evaluate(() => __layerEditorQA.sources.getLayers().map(source => ({ id: source.id, sampleId: source.sampleId, settings: source.settings, notes: source.score.analysis.notes })));
const sampleState = page => page.evaluate(() => __layerEditorQA.engine.state.samples.map(sample => ({ id: sample.id, paused: sample.paused, loop: sample.loop, position: sample.positionBeats, version: sample.scoreVersion, program: sample.program, midiProgram: sample.midi.program ?? null })));

test('explicit layer settings edit live geometry and instruments while sibling playback continues', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  const [first, second] = await pair(page), before = await sourceState(page), initialSamples = await sampleState(page);
  await row(page, first).locator('[data-layer-settings]').click();
  await expect(editor(page)).toBeVisible(); await expect(editor(page)).toHaveAttribute('data-spigot-id', first);
  const [panelBox, rackBox] = await Promise.all([editor(page).boundingBox(), page.locator('#blechLiveLayers').boundingBox()]);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(rackBox.y + rackBox.height + 1);
  await expect(row(page, first)).toHaveAttribute('data-selected', 'true');
  expect((await row(page, first).boundingBox()).height).toBeLessThanOrEqual(34);
  expect(await editor(page).evaluate(node => node.previousElementSibling?.dataset.spigotId)).toBe(first);
  await expect.poll(async () => (await sampleState(page))[0].position).toBeGreaterThan(.1);
  for (const [key, value] of [['rotationDegrees', 90], ['widthNotes', 19], ['heightBeats', 32], ['transpose', 7], ['delayBeats', .5]]) {
    await number(page, `#blechLayerEditor [data-layer-field="${key}"]`, value);
    await expect.poll(async () => (await sourceState(page))[0].settings[key]).toBe(value);
  }
  const after = await sourceState(page), current = await sampleState(page);
  expect(after[0].notes).not.toEqual(before[0].notes); expect(after[0].sampleId).toBe(before[0].sampleId);
  expect(after[1]).toEqual(before[1]); expect(current[0].version).toBeGreaterThan(initialSamples[0].version);
  expect(current[0].paused).toBe(false); expect(current[1].position).toBeGreaterThan(initialSamples[1].position);
  await editor(page).locator('[data-layer-program]').selectOption('40');
  expect((await sampleState(page))[0]).toMatchObject({ program: 40, midiProgram: 40 });
  await editor(page).locator('[data-layer-program]').selectOption('original');
  expect((await sampleState(page))[0]).toMatchObject({ program: null, midiProgram: null });
  expect((await sourceState(page))[0].settings.program).toBe('original');
  const firstAfterInstrument = (await sourceState(page))[0];
  await row(page, second).locator('[data-layer-settings]').click();
  await expect(editor(page)).toHaveAttribute('data-spigot-id', second);
  await expect(row(page, first).locator('[data-layer-settings]')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, second)).toHaveAttribute('data-selected', 'true');
  await number(page, '#blechLayerEditor [data-layer-field="rotationDegrees"]', 45);
  expect((await sourceState(page))[0]).toEqual(firstAfterInstrument);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect(errors).toEqual([]);
});

test('settings open from the keyboard and close on Escape, outside click or explicit close without hover reopening', async ({ page }) => {
  await open(page); const [first, second] = await pair(page), gear = row(page, first).locator('[data-layer-settings]');
  await gear.focus(); await page.keyboard.press('Enter');
  await expect(editor(page)).toBeVisible(); await expect(editor(page).locator('input').first()).toBeFocused();
  await page.keyboard.press('Escape'); await expect(editor(page)).toBeHidden(); await expect(gear).toBeFocused();
  await gear.hover(); await expect(editor(page)).toBeHidden();
  await gear.click(); await row(page, second).locator('[data-layer-select]').click(); await expect(editor(page)).toBeHidden();
  await gear.click(); await editor(page).locator('[data-layer-editor-close]').click(); await expect(editor(page)).toBeHidden(); await expect(gear).toBeFocused();
  await row(page, first).locator('[data-layer-pause]').click();
  await gear.click(); await number(page, '#blechLayerEditor [data-layer-field="heightBeats"]', 16);
  expect((await sampleState(page))[0].paused).toBe(true); expect((await sampleState(page))[1].paused).toBe(false);
});

test.describe('touch layer settings', () => {
  test.use({ hasTouch: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) test(`remain reachable inside their rack at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await open(page); const [first] = await pair(page);
    await row(page, first).locator('[data-layer-settings]').click(); await expect(editor(page)).toBeVisible();
    expect((await row(page, first).boundingBox()).height).toBeLessThanOrEqual(54);
    expect((await editor(page).boundingBox()).width).toBeLessThanOrEqual(viewport.width);
    for (const target of ['[data-layer-field="transpose"]', '[data-layer-field="widthNotes"]', '[data-layer-field="heightBeats"]', '[data-layer-field="rotationDegrees"]', '[data-layer-program]', '[data-layer-editor-close]']) {
      const control = editor(page).locator(target); await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(48); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  });
});
