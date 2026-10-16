import { test, expect } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__spigotQA = { contexts: 0 };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __spigotQA.contexts++; } };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){__spigotQA.engine=this;return observeVolume.apply(this,args);};` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-spigots.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace('export function mountBlechSpigots(', 'function observedMountBlechSpigots(');
    await route.fulfill({ response, body: `${source}\nexport function mountBlechSpigots(viewport,options){__spigotQA.layers=options.getLayers;__spigotQA.ui=observedMountBlechSpigots(viewport,options);return __spigotQA.ui;}` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('[data-spigot-mode="draw"]')).toBeVisible();
  await expect(page.locator('#blechDropSend')).toBeEnabled();
}

async function number(page, selector, value) {
  if (selector.startsWith('[data-layer-field') && !await page.locator('#blechLayerEditor').isVisible()) await page.locator('.blech-live-layer[data-selected="true"] [data-layer-settings]').click();
  await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab');
}
const sources = page => page.evaluate(() => __spigotQA.layers().map(layer => ({
  id: layer.id, name: layer.name, settings: layer.settings, playing: layer.playing, paused: layer.paused,
  notes: layer.score?.analysis?.notes.map(note => [note.note, note.beat, note.duration]),
})));
const sampleState = page => page.evaluate(() => __spigotQA.engine.state.samples.map(sample => ({
  id: sample.id, position: sample.positionBeats, cycle: sample.cycle, count: sample.analysis.noteCount,
  gain: sample.gain, program: sample.midi.program, channel: sample.channel, loop: sample.loop, paused: sample.paused,
  version: sample.scoreVersion, pending: Boolean(sample.pendingReplacement),
})));
async function point(page, x = .5, y = .5) {
  const rect = await page.locator('.blech-spigot-paint').boundingBox();
  return { x: rect.x + rect.width * x, y: rect.y + rect.height * y };
}
const tool = async (page, mode) => {
  await page.locator(`[data-spigot-mode="${mode}"]`).click();
  if (mode === 'stamp') {
    await page.locator('.blech-spigot-stamp-grid [data-stamp-id="heart"]').click();
    await expect(page.locator('.blech-spigot-overlay')).toHaveAttribute('data-mode', 'stamp');
  }
};
const failures = new WeakMap();
test.beforeEach(({ page }) => { failures.set(page, []); page.on('pageerror', error => failures.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(failures.get(page)).toEqual([]));

test('stage stamping starts its chosen source, and a held drawing extends one independent layer without arming Audio', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await number(page, '#blechDropWidth', 25); await number(page, '#blechDropHeight', 2);
  await page.locator('#blechDropChannel').selectOption({ value: '6' }); await page.locator('#blechDropProgram').selectOption({ value: '4' });
  await page.locator('#blechDropGain').evaluate(node => { node.value = '.42'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await tool(page, 'stamp'); const a = await point(page, .65, .65); await page.mouse.click(a.x, a.y);
  await expect.poll(async () => (await sources(page)).length).toBe(1);
  const first = (await sources(page))[0]; expect(first.notes.length).toBeGreaterThan(0);
  expect((await sampleState(page))[0]).toMatchObject({ channel: 6, program: 4, gain: .42 });
  await tool(page, 'draw'); const b = await point(page, .4, .5); await page.mouse.move(b.x, b.y); await page.mouse.down();
  await page.waitForTimeout(250); const during = await sources(page); expect(during.length).toBe(2);
  await page.waitForTimeout(250); await page.mouse.move(b.x + 45, b.y + 15, { steps: 8 }); await page.mouse.up();
  const after = await sources(page); expect(after.length).toBe(2); expect(after[0].id).toBe(first.id);
  expect(after[1].notes.length).toBeGreaterThan(during[1].notes.length);
  expect(new Set(after[1].notes.map(note => note[0])).size).toBeGreaterThan(1);
  await expect(page.locator('.blech-live-layer[data-spigot-id]')).toHaveCount(2);
  await expect(page.locator('.blech-spigot-emitter')).toHaveCount(0);
  expect(await page.evaluate(() => __spigotQA.contexts)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#creativeStop').click();
  expect(await sampleState(page)).toEqual([]);
  await page.waitForTimeout(200); expect(await sampleState(page)).toEqual([]);
});

test('selected layer edits alter the current MIDI pass while another layer keeps playing', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await number(page, '#blechDropWidth', 25); await number(page, '#blechDropHeight', 64); await number(page, '#blechDropDelay', 0);
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click(); await page.locator('#blechDropSend').click();
  await expect.poll(async () => (await sources(page)).length).toBe(2);
  const initial = await sources(page), samples = await sampleState(page);
  const row = page.locator(`.blech-live-layer[data-spigot-id="${initial[0].id}"]`);
  await row.locator('[data-layer-select]').click();
  await expect(row).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('.blech-spigot-selection')).toHaveAttribute('data-spigot-id', initial[0].id);
  await expect(page.locator('.blech-drop-overlay')).toBeHidden();
  await expect.poll(async () => (await sampleState(page))[0]?.position).toBeGreaterThan(.05);
  await number(page, '[data-layer-field="rotationDegrees"]', 90);
  const edited = await sources(page); expect(edited[0].notes).not.toEqual(initial[0].notes); expect(edited[0].notes.length).toBe(initial[0].notes.length);
  expect(edited[1]).toEqual(initial[1]);
  expect((await sampleState(page))[0].id).toBe(samples[0].id);
  await expect.poll(async () => (await sampleState(page))[0]?.version).toBeGreaterThan(samples[0].version);
  expect((await sampleState(page))[0].cycle).toBe(0);
  expect((await sampleState(page))[0].pending).toBe(false);
  expect((await sampleState(page))[0].position).toBeGreaterThan(.05);
  await number(page, '[data-layer-field="heightBeats"]', 1);
  await page.locator('[data-spigot-loop]').click();
  expect((await sources(page)).find(source => source.id === initial[0].id).settings.loop).toBe(false);
  expect((await sampleState(page)).find(sample => sample.id === samples[1].id).loop).toBe(true);
  expect((await sampleState(page)).find(sample => sample.id === samples[0].id)?.loop ?? false).toBe(false);
  await expect.poll(async () => (await sampleState(page)).length).toBe(1);
  expect((await sources(page)).length).toBe(2);
  // Keep the replay observable on a busy browser; the short pass above can
  // naturally finish before a polling assertion gets its first sample.
  await number(page, '[data-layer-field="heightBeats"]', 8);
  await page.locator('[data-spigot-play]').click();
  await expect.poll(async () => (await sampleState(page)).length).toBe(2);
  await page.locator('[data-spigot-remove]').click();
  await expect.poll(async () => (await sources(page)).length).toBe(1);
});

test('layer selection reveals one rectangle and pointer gestures reshape the live source without a new drop', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await number(page, '#blechDropWidth', 40); await number(page, '#blechDropHeight', 8); await number(page, '#blechDropDelay', 1);
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click(); await page.locator('#blechDropSend').click();
  const initial = await sources(page), first = page.locator(`.blech-live-layer[data-spigot-id="${initial[0].id}"]`), second = page.locator(`.blech-live-layer[data-spigot-id="${initial[1].id}"]`);
  await tool(page, 'draw'); await first.locator('[data-layer-select]').click();
  await expect(page.locator('.blech-spigot-overlay')).toHaveAttribute('data-mode', 'select');
  await expect(page.locator('.blech-spigot-selection:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.blech-spigot-move')).toBeVisible();
  await expect(page.locator('.blech-spigot-emitter')).toHaveCount(0);
  const move = page.locator('.blech-spigot-move'), box = await move.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 18); await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 18, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await sources(page))[0].settings.transpose).toBeGreaterThan(initial[0].settings.transpose);
  const moved = (await sources(page))[0], grip = await page.locator('[data-spigot-resize="right"]').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 45, grip.y + grip.height / 2, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await sources(page))[0].settings.widthNotes).toBeGreaterThan(moved.settings.widthNotes);
  const resized = await move.boundingBox(), rotate = await page.locator('.blech-spigot-rotate').boundingBox();
  await page.mouse.move(rotate.x + rotate.width / 2, rotate.y + rotate.height / 2); await page.mouse.down();
  await page.mouse.move(resized.x + resized.width - 10, resized.y + resized.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await sources(page))[0].settings.rotationDegrees).not.toBe(0);
  expect((await sources(page))[1]).toEqual(initial[1]);
  expect((await sampleState(page)).length).toBe(2);
  await expect(first).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('.blech-spigot-editor')).toHaveCount(0);
  const cancelBox = await move.boundingBox();
  await page.mouse.move(cancelBox.x + 20, cancelBox.y + 18); await page.mouse.down();
  const beforeCancel = (await sources(page))[0].settings;
  await move.evaluate((node, point) => {
    node.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, isPrimary: true, clientX: point.x, clientY: point.y, bubbles: true }));
    dispatchEvent(new Event('blur'));
  }, { x: cancelBox.x + 70, y: cancelBox.y + 18 });
  await page.mouse.up(); await page.waitForTimeout(150);
  expect((await sources(page))[0].settings).toEqual(beforeCancel);
  await second.locator('[data-layer-select]').focus(); await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('data-selected', 'false');
  await expect(page.locator('.blech-spigot-selection')).toHaveAttribute('data-spigot-id', initial[1].id);
  await page.locator('[data-spigot-deselect]').click();
  await expect(page.locator('.blech-spigot-selection')).toBeHidden();
  await expect(second).toHaveAttribute('data-selected', 'false');
  expect(await page.evaluate(() => __spigotQA.contexts)).toBe(0);
});


test('canvas and transport never open an editor; layer settings own its parameters', async ({ page }) => {
  await open(page);
  await number(page, '#blechDropWidth', 40); await number(page, '#blechDropHeight', 8); await number(page, '#blechDropDelay', 1);
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
  await expect(page.locator('[data-spigot-mode="select"]')).toHaveCount(0);
  for (const selector of ['.blech-spigot-move', '[data-spigot-play]', '[data-spigot-loop]']) {
    await page.locator(selector).hover(); await page.locator(selector).focus();
    await expect(page.locator('.blech-spigot-editor')).toHaveCount(0);
    await expect(page.locator('#blechLayerEditor')).toBeHidden();
  }
  const gear = page.locator('.blech-live-layer [data-layer-settings]');
  await gear.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#blechLayerEditor')).toBeVisible();
  await number(page, '[data-layer-field="transpose"]', 3);
  expect((await sources(page))[0].settings.transpose).toBe(3);
  await page.locator('[data-layer-editor-close]').click();
  await expect(page.locator('#blechLayerEditor')).toBeHidden();
  expect(await page.evaluate(() => __spigotQA.contexts)).toBe(0);
});

test('a replayed saved drop becomes an editable layer without restarting or duplicating it', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await number(page, '#blechDropWidth', 30); await number(page, '#blechDropHeight', 64); await number(page, '#blechDropDelay', 0);
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
  await page.locator('[data-layer-stop]').click();
  await page.locator('#blechSavedDrops summary').click();
  await page.locator('#blechSavedDrops [data-pad-play]').first().click();
  await expect.poll(async () => (await sampleState(page)).length).toBe(1);
  await expect.poll(async () => (await sampleState(page))[0].position).toBeGreaterThan(.1);
  const before = (await sampleState(page))[0];
  await page.locator('[data-layer-select]').click();
  const selected = (await sampleState(page))[0];
  expect(selected.id).toBe(before.id); expect(selected.version).toBe(before.version); expect(selected.position).toBeGreaterThanOrEqual(before.position);
  await expect(page.locator('.blech-spigot-move')).toBeVisible();
  await number(page, '[data-layer-field="rotationDegrees"]', 90);
  await expect.poll(async () => (await sampleState(page))[0].version).toBeGreaterThan(before.version);
  expect((await sampleState(page)).length).toBe(1);
  expect((await sampleState(page))[0].id).toBe(before.id);
  expect(await page.evaluate(() => __spigotQA.contexts)).toBe(0);
});

test('drawing sounds with explicit Audio and pointer cancellation stops new emission', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await tool(page, 'draw'); const p = await point(page, .5, .94); await page.mouse.move(p.x, p.y); await page.mouse.down();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  await page.locator('.blech-spigot-paint').dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  const count = (await sources(page))[0].notes.length;
  await page.waitForTimeout(250); expect((await sources(page))[0].notes.length).toBe(count);
  expect(await page.evaluate(() => __spigotQA.contexts)).toBe(1);
  await page.locator('#creativeStop').click();
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(.0001);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.blech-spigot-overlay')).toHaveCount(0);
});

test.describe('touch layer settings', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('the layer gear edits parameters without a canvas hover popup', async ({ page }) => {
    await open(page);
    await number(page, '#blechDropWidth', 40); await number(page, '#blechDropHeight', 8); await number(page, '#blechDropDelay', 1);
    await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
    await page.locator('.blech-live-layer [data-layer-settings]').tap();
    await expect(page.locator('#blechLayerEditor')).toBeVisible();
    await number(page, '[data-layer-field="transpose"]', 4);
    expect((await sources(page))[0].settings.transpose).toBe(4);
    await expect(page.locator('.blech-spigot-editor')).toHaveCount(0);
    await page.locator('[data-layer-editor-close]').tap();
    expect(await page.evaluate(() => __spigotQA.contexts)).toBe(0);
  });
});

for (const [name, width, height] of [['phone', 390, 844], ['landscape', 844, 390]]) {
  test(`spigot controls and keyboard remain reachable on ${name}`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height }); await open(page);
    await number(page, '#blechDropWidth', 21); await number(page, '#blechDropHeight', 1);
    await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
    await expect(page.locator('.blech-live-layer')).toHaveCount(1); await page.locator('[data-layer-select]').click();
    await number(page, '[data-layer-field="rotationDegrees"]', 90);
    await expect(page.locator('[data-layer-field="rotationDegrees"]')).toHaveValue('90');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const canvas = await page.locator('#blackMidiViewport').boundingBox(); expect(canvas.height).toBeGreaterThanOrEqual(48);
    await page.locator('#blechMasterPlay').scrollIntoViewIfNeeded();
    await expect(page.locator('#blechMasterPlay')).toBeInViewport();
    await page.locator('#blechMasterPlay').click();
    await expect(page.locator('#blechMasterPlay')).toHaveAttribute('aria-pressed', 'false');
    await tool(page, 'draw');
    const paint = await page.locator('.blech-spigot-paint').boundingBox();
    const currentCanvas = await page.locator('#blackMidiViewport').boundingBox();
    expect(paint.y + paint.height).toBeLessThan(currentCanvas.y + currentCanvas.height);
  });
}
