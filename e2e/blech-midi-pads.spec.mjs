import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__padsQA = { contexts: [], engine: null, launches: [], notes: [], graphics: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __padsQA.contexts.push(this); } };
  });
  // Passive observers retain the production scheduler, SoundFont, audio clock,
  // output path, note notifications and renderer. No fake sample state or sound.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume = MidiMixerEngine.prototype.setVolume, qaTrigger = MidiMixerEngine.prototype.triggerSample, qaSeen = new WeakSet();
      MidiMixerEngine.prototype.setVolume = function(...args) {
        __padsQA.engine = this;
        if (!qaSeen.has(this)) { qaSeen.add(this); this.subscribeNotes(notes => {
          __padsQA.notes.push(...notes.map(note => ({ ...note })));
          if (__padsQA.notes.length > 20000) __padsQA.notes.splice(0, __padsQA.notes.length - 20000);
        }); }
        return qaVolume.apply(this, args);
      };
      MidiMixerEngine.prototype.triggerSample = function(buffer, ...args) {
        const sample = qaTrigger.call(this, buffer, ...args);
        if (sample) __padsQA.launches.push({ id: sample.id, name: sample.name, bytes: Array.from(new Uint8Array(buffer)),
          loop: sample.loop, duration: sample.analysis.durationBeats,
          notes: sample.analysis.notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity })) });
        return sample;
      };` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-live-score.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaProject = createBlechLiveProjector;
      createBlechLiveProjector = function(...args) { const project = qaProject(...args); return function(...args) {
        const result = project(...args); __padsQA.graphics.push(...result.notes.map(note => ({ ...note })));
        if (__padsQA.graphics.length > 20000) __padsQA.graphics.splice(0, __padsQA.graphics.length - 20000);
        return result;
      }; };` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechStampPicker [data-stamp-id]')).toHaveCount(58);
  await frameTab(page, 'stamps');
  await input(page, 'blechDropDelay', 0, 'change');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
}
const layer = (page, id) => page.locator(`#blechLiveLayers [data-sample-id="${id}"]`);
async function frameTab(page, id) {
  await page.locator('#blechTab-frames').click(); await page.locator(`#blechTab-${id}`).click();
  await expect(page.locator(`#blechPanel-${id}`)).toBeVisible();
}
async function chooseStamp(page, id, wait = true) {
  await frameTab(page, 'stamps');
  await page.locator('#blechStampPicker summary').click();
  await page.locator(`#blechStampPicker [data-stamp-id="${id}"]`).click();
  if (wait) await expect(page.locator('#blechDropSend')).toBeEnabled();
}
async function drop(page, loop = true) {
  await page.locator(loop ? '#blechDropLoop' : '#blechDropOnce').click();
  return launch(page, () => page.locator('#blechDropSend').click());
}
const saved = page => page.locator('#mixerSavedPads [data-saved-pad]');
const launches = page => page.evaluate(() => __padsQA.launches);
const state = page => page.evaluate(() => ({
  contexts: __padsQA.contexts.length, audio: __padsQA.engine.state.audioEnabled, playing: __padsQA.engine.state.playing,
  samples: __padsQA.engine.state.samples.map(sample => ({ id: sample.id, loop: sample.loop, pending: sample.pending,
    position: sample.positionBeats, cycle: sample.cycle, duration: sample.analysis.durationBeats })),
}));
const sample = async (page, id) => (await state(page)).samples.find(item => item.id === id);
const progress = async (page, id) => { const current = await sample(page, id); return current ? current.cycle * current.duration + current.position : -1; };
async function input(page, id, value, event = 'input') {
  await page.locator(`#${id}`).evaluate((node, detail) => {
    node.value = String(detail.value); node.dispatchEvent(new Event(detail.event, { bubbles: true }));
  }, { value, event });
}
async function launch(page, action) {
  const before = (await launches(page)).length; await action();
  await expect.poll(async () => (await launches(page)).length).toBe(before + 1);
  return (await launches(page)).at(-1);
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
}
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 30 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001);
  expect(summary.clippedSamples).toBe(0); expect(summary.maxPeak).toBeLessThanOrEqual(.981);
  return summary;
}
async function silent(page) { await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001); }
async function drawing(page, glyph = '❤') { await frameTab(page, 'drawing'); await page.locator(`[data-drawing-stamp="${glyph}"]`).click(); await expect(page.locator('#blechDropSend')).toBeEnabled(); }
async function download(page) {
  const pending = page.waitForEvent('download'); await page.locator('#downloadDrawingMidi').click();
  return readFile(await (await pending).path());
}
const pitches = notes => [...new Set(notes.map(note => note.note))].sort((a, b) => a - b);
function transformed(first, next, { stretch, offset }) {
  expect(next.duration).toBeCloseTo(first.duration * stretch, 2); expect(next.notes.length).toBe(first.notes.length);
  next.notes.forEach((note, index) => {
    const original = first.notes[index]; expect(note.note).toBe(original.note + offset); expect(note.velocity).toBe(original.velocity);
    expect(note.beat).toBeCloseTo(original.beat * stretch, 2); expect(note.duration).toBeCloseTo(original.duration * stretch, 2);
  });
}

test('dropped native loops stop independently while another layer keeps its phase and sound', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page);
  expect((await launches(page)).length).toBe(0);
  await input(page, 'mixerStampBeats', 4); await input(page, 'mixerStampSpan', 12); await input(page, 'creativeTempo', 240);
  await page.locator('#blechDropProgram').selectOption('16'); await arm(page);
  await chooseStamp(page, 'heart'); const heart = await drop(page);
  await chooseStamp(page, 'square'); const square = await drop(page);
  expect((await state(page)).samples.map(item => item.id)).toEqual([heart.id, square.id]);
  await page.locator('#blechStampPicker summary').click();
  await page.locator('#blechStampPicker input[type="search"]').fill('noise');
  await expect(page.locator('#blechStampPicker [data-stamp-id="heart"]')).toBeHidden();
  await expect(layer(page, heart.id)).toBeVisible(); await expect(layer(page, square.id)).toBeVisible();
  await page.locator('#blechStampPicker input[type="search"]').press('Escape');
  await expect.poll(async () => (await sample(page, square.id))?.cycle).toBeGreaterThanOrEqual(1); await audible(page);
  const before = await progress(page, square.id); await layer(page, heart.id).locator('[data-layer-stop]').click();
  await expect(layer(page, heart.id)).toHaveCount(0);
  expect((await state(page)).samples.map(item => item.id)).toEqual([square.id]); expect((await launches(page)).length).toBe(2);
  await expect.poll(() => progress(page, square.id)).toBeGreaterThan(before + .25);
  const remaining = await audible(page);
  await chooseStamp(page, 'heart'); const restarted = await drop(page); expect(restarted.id).not.toBe(heart.id);
  expect((await state(page)).samples.map(item => item.id).sort()).toEqual([square.id, restarted.id].sort());
  await layer(page, restarted.id).locator('[data-layer-stop]').click();
  expect((await launches(page)).length).toBe(3); expect((await state(page)).samples.map(item => item.id)).toEqual([square.id]);
  await layer(page, square.id).locator('[data-layer-stop]').click(); await silent(page);
  expect((await state(page)).samples).toEqual([]); expect((await state(page)).playing).toBe(false);
  await testInfo.attach('remaining-pad-native-audio', { body: JSON.stringify(remaining), contentType: 'application/json' });
});

test('repeated one-shot drops create independent immutable copies and each finishes naturally', async ({ page }) => {
  await open(page); await input(page, 'mixerStampBeats', 32); await input(page, 'creativeTempo', 300);
  await chooseStamp(page, 'heart'); const first = await drop(page, false);
  await chooseStamp(page, 'square'); const other = await drop(page, false);
  await chooseStamp(page, 'heart'); const again = await drop(page, false);
  expect(again.id).not.toBe(first.id); expect(again.loop).toBe(false); expect(again.bytes).toEqual(first.bytes);
  expect((await state(page)).samples.map(item => item.id).sort()).toEqual([first.id, other.id, again.id].sort());
  await expect(layer(page, first.id)).toBeVisible(); await expect(layer(page, again.id)).toBeVisible();
  await expect.poll(async () => (await state(page)).samples.length, { timeout: 12000 }).toBe(0);
  await expect(page.locator('#blechLiveLayers [data-sample-id]')).toHaveCount(0);
  await expect(page.locator('#blechStampPicker summary')).toContainText('Heart');
  await expect(saved(page)).toHaveCount(3);
  expect((await launches(page)).length).toBe(3); expect((await state(page)).contexts).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('sent drawings retain immutable thumbnail pads with independent loop, replay and remove controls', async ({ page }) => {
  await open(page); await input(page, 'mixerStampBeats', 4); await input(page, 'mixerStampSpan', 12); await input(page, 'creativeTempo', 240);
  await drawing(page); const first = await drop(page);
  await frameTab(page, 'stamps'); await expect(saved(page)).toHaveCount(1);
  const firstKey = await saved(page).first().getAttribute('data-saved-pad'); expect(firstKey).toBeTruthy();
  const card = page.locator(`#mixerSavedPads [data-saved-pad="${firstKey}"]`);
  await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'true'); await expect(card.locator('[data-pad-loop]')).toBeChecked();
  expect(await card.locator('canvas').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
  const thumbnail = await card.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await drawing(page, 'spiral'); const second = await drop(page);
  await frameTab(page, 'stamps'); await expect(saved(page)).toHaveCount(2); expect(second.bytes).not.toEqual(first.bytes);
  expect(await saved(page).last().locator('canvas').evaluate(canvas => canvas.toDataURL())).not.toBe(thumbnail);
  const secondKey = await saved(page).last().getAttribute('data-saved-pad');
  const other = page.locator(`#mixerSavedPads [data-saved-pad="${secondKey}"]`);
  await drawing(page, '⭐'); await input(page, 'mixerStampBeats', 6); await input(page, 'mixerStampOffset', 12);
  await frameTab(page, 'stamps');
  expect(await card.locator('canvas').evaluate(canvas => canvas.toDataURL())).toBe(thumbnail); expect((await launches(page))[0].bytes).toEqual(first.bytes);
  await card.locator('[data-pad-loop]').uncheck();
  expect((await sample(page, first.id))?.loop).toBe(false); expect((await sample(page, second.id))?.loop).toBe(true);
  await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'false', { timeout: 8000 });
  await expect(other.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'true');
  await card.locator('[data-pad-loop]').check(); const replay = await launch(page, () => card.locator('[data-pad-play]').click());
  expect(replay.id).not.toBe(first.id); expect(replay.bytes).toEqual(first.bytes); expect(replay.notes).toEqual(first.notes); expect(replay.loop).toBe(true);
  await card.locator('[data-pad-play]').click(); await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).samples.map(item => item.id)).toEqual([second.id]);
  await card.locator('[data-pad-remove]').click(); await expect(card).toHaveCount(0);
  await other.locator('[data-pad-remove]').click(); await expect(saved(page)).toHaveCount(0);
  expect((await state(page)).samples).toEqual([]); expect((await state(page)).contexts).toBe(0);
});

test('height and horizontal offset transform stamps and drawing exports, matching native audio and the falling-note projector', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page);
  expect(await page.locator('#mixerStampBeats').evaluate(node => Number(node.min))).toBe(.25); expect(await page.locator('#mixerStampBeats').evaluate(node => Number(node.max))).toBe(64);
  await expect(page.locator('#mixerStampBeats')).toHaveAccessibleName(/height.*beats/i);
  await expect(page.locator('#mixerStampOffset')).toHaveAttribute('min', '-127'); await expect(page.locator('#mixerStampOffset')).toHaveAttribute('max', '127');
  await input(page, 'mixerStampSpan', 12); await input(page, 'mixerStampBeats', 2); await input(page, 'mixerStampOffset', 0);
  await chooseStamp(page, 'square'); const original = await drop(page, false); await page.locator('#blechDropStop').click();
  await input(page, 'mixerStampBeats', 6); await input(page, 'mixerStampOffset', 12);
  const moved = await drop(page, false); transformed(original, moved, { stretch: 3, offset: 12 });
  await page.locator('#blechDropStop').click(); await drawing(page, 'wave');
  const pixels = await page.locator('#drawingCanvas').getAttribute('data-pixels');
  await input(page, 'mixerStampBeats', 2); await input(page, 'mixerStampOffset', 0);
  const draft = await drop(page, false);
  expect(Array.from(await download(page))).toEqual(draft.bytes); await page.locator('#blechDropStop').click();
  await input(page, 'mixerStampBeats', 6); await input(page, 'mixerStampOffset', 12); await input(page, 'creativeTempo', 300);
  await page.locator('#blechDropProgram').selectOption('16'); await arm(page); const sounding = await drop(page);
  transformed(draft, sounding, { stretch: 3, offset: 12 });
  const bytes = await download(page); expect(Array.from(bytes)).toEqual(sounding.bytes);
  expect(parseMidi(bytes).notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity }))).toEqual(sounding.notes);
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', pixels);
  const expected = pitches(sounding.notes);
  await expect.poll(() => page.evaluate(id => [...new Set(__padsQA.notes.filter(note => note.type === 'noteOn' && note.sampleId === id).map(note => note.note))].sort((a, b) => a - b), sounding.id)).toEqual(expected);
  await expect.poll(() => page.evaluate(id => [...new Set(__padsQA.graphics.filter(note => note.source === `sample:${id}`).map(note => note.pitch))].sort((a, b) => a - b), sounding.id)).toEqual(expected);
  const audio = await audible(page); await page.locator('#creativeStop').click(); await silent(page);
  await testInfo.attach('transformed-drawing-native-audio', { body: JSON.stringify(audio), contentType: 'application/json' });
});

test('selecting another stamp cancels a pending file fetch without stopping a loop or launching late notes', async ({ page }) => {
  test.setTimeout(60000); await open(page); await chooseStamp(page, 'square'); const other = await drop(page);
  let ready, release, done, pending;
  const started = new Promise(resolve => { ready = resolve; }), gate = new Promise(resolve => { release = resolve; }), finished = new Promise(resolve => { done = resolve; });
  await page.route('**/assets/midiphoria/midi/black-pattern-3-beat-funnel-128.mid', async route => {
    pending = route.request(); const response = await route.fetch(); ready(); await gate;
    try { await route.fulfill({ response }); } catch { /* The requested cancellation may already have closed it. */ } finally { done(); }
  });
  try {
    await chooseStamp(page, 'black-pattern-3-beat-funnel-128', false); await started;
    await expect(page.locator('#blechStampPicker summary')).toContainText(/funnel/i);
    const before = await progress(page, other.id);
    await chooseStamp(page, 'heart'); release(); await finished;
    await expect.poll(() => Boolean(pending.failure()), { message: 'changing the selected source aborts its old fetch' }).toBe(true);
    await expect.poll(() => progress(page, other.id)).toBeGreaterThan(before + .25);
    await expect(layer(page, other.id)).toBeVisible(); await expect(page.locator('#blechDropName')).toContainText('Heart');
    expect((await launches(page)).map(item => item.id)).toEqual([other.id]); expect((await state(page)).samples.map(item => item.id)).toEqual([other.id]);
    expect((await state(page)).contexts).toBe(0); await page.locator('#creativeStop').click();
  } finally { release(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`shared Drop, saved loops and frame geometry remain touch and keyboard reachable at ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage(), failures = []; page.on('pageerror', error => failures.push(error.message));
    try {
      await open(page); await drawing(page); await drop(page);
      await frameTab(page, 'stamps'); const card = saved(page).first();
      for (const control of [page.locator('#blechDropSend'), card.locator('[data-pad-play]'), card.locator('[data-pad-loop]').locator('..'), card.locator('[data-pad-remove]')]) {
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible(); const box = await control.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      for (const id of ['mixerStampBeats', 'mixerStampOffset']) {
        const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await card.locator('[data-pad-play]').focus(); await page.keyboard.press('Space'); await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'false');
      await card.locator('[data-pad-loop]').focus(); await page.keyboard.press('Space'); await expect(card.locator('[data-pad-loop]')).not.toBeChecked();
      await input(page, 'mixerStampOffset', 0); await page.locator('#mixerStampOffset').focus(); await page.keyboard.press('ArrowRight');
      await expect(page.locator('#mixerStampOffset')).toHaveValue('1');
      await page.locator('#blechStampPicker summary').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
      await expect(page.locator('#blechStampPicker summary')).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.locator('#mixerSavedPads').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect((await state(page)).contexts).toBe(0); expect(failures).toEqual([]);
      await saved(page).first().scrollIntoViewIfNeeded(); await testInfo.attach(`saved-pads-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    } finally { await context.close(); }
  });
}
