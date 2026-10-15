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
const tool = (page, mode) => page.locator(`[data-spigot-mode="${mode}"]`).click();
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
  await expect(page.locator('.blech-spigot-emitter')).toHaveCount(2);
  expect(await page.evaluate(() => __spigotQA.contexts)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#creativeStop').click();
  expect(await sampleState(page)).toEqual([]);
  await page.waitForTimeout(200); expect(await sampleState(page)).toEqual([]);
});

test('source edits alter real MIDI at the next loop, leaving another layer and the current pass intact', async ({ page }) => {
  test.setTimeout(60000); await open(page);
  await number(page, '#blechDropWidth', 25); await number(page, '#blechDropHeight', 4); await number(page, '#blechDropDelay', 0);
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click(); await page.locator('#blechDropSend').click();
  await expect.poll(async () => (await sources(page)).length).toBe(2);
  const initial = await sources(page), samples = await sampleState(page);
  await page.locator(`.blech-spigot-emitter[data-spigot-id="${initial[0].id}"]`).click();
  await expect.poll(async () => (await sampleState(page))[0]?.position).toBeGreaterThan(.05);
  await number(page, '[data-spigot-field="rotationDegrees"]', 90);
  const edited = await sources(page); expect(edited[0].notes).not.toEqual(initial[0].notes); expect(edited[0].notes.length).toBe(initial[0].notes.length);
  expect(edited[1]).toEqual(initial[1]);
  expect((await sampleState(page))[0].id).toBe(samples[0].id);
  await expect.poll(async () => (await sampleState(page))[0]?.version).toBeGreaterThan(samples[0].version);
  await page.locator('[data-spigot-loop]').click();
  expect((await sampleState(page))[0].loop).toBe(false); expect((await sampleState(page))[1].loop).toBe(true);
  await expect.poll(async () => (await sampleState(page)).length).toBe(1);
  expect((await sources(page)).length).toBe(2);
  await page.locator('[data-spigot-play]').click();
  await expect.poll(async () => (await sampleState(page)).length).toBe(2);
  await page.locator('[data-spigot-remove]').click();
  await expect.poll(async () => (await sources(page)).length).toBe(1);
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

for (const [name, width, height] of [['phone', 390, 844], ['landscape', 844, 390]]) {
  test(`spigot controls and keyboard remain reachable on ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page);
    await number(page, '#blechDropWidth', 21); await number(page, '#blechDropHeight', 1);
    await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
    await expect(page.locator('.blech-spigot-emitter')).toHaveCount(1); await page.locator('.blech-spigot-emitter').click();
    await number(page, '[data-spigot-field="rotationDegrees"]', 90);
    await expect(page.locator('[data-spigot-field="rotationDegrees"]')).toHaveValue('90');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const canvas = await page.locator('#blackMidiViewport').boundingBox(); expect(canvas.height).toBeGreaterThanOrEqual(48);
    await expect(page.locator('#blechMasterPlay')).toBeInViewport();
    await tool(page, 'draw');
    const paint = await page.locator('.blech-spigot-paint').boundingBox();
    expect(paint.y + paint.height).toBeLessThan(canvas.y + canvas.height);
  });
}
