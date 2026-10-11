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
  await page.route('**/src/instruments/midiphoria/midiphoria-renderer.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaCapture = MidiphoriaRenderer.prototype.captureEvent;
      MidiphoriaRenderer.prototype.captureEvent = function(event) {
        __padsQA.graphics.push({ ...event });
        if (__padsQA.graphics.length > 20000) __padsQA.graphics.splice(0, __padsQA.graphics.length - 20000);
        return qaCapture.call(this, event);
      };` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('[data-mixer-sample]')).toHaveCount(58);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
}
const pad = (page, id) => page.locator(`[data-mixer-sample="${id}"]`);
const saved = page => page.locator('#mixerSavedPads [data-saved-pad]');
const launches = page => page.evaluate(() => __padsQA.launches);
const state = page => page.evaluate(() => ({
  contexts: __padsQA.contexts.length, audio: __padsQA.engine.state.audioEnabled, playing: __padsQA.engine.state.playing,
  samples: __padsQA.engine.state.samples.map(sample => ({ id: sample.id, loop: sample.loop, pending: sample.pending,
    position: sample.positionBeats, cycle: sample.cycle, duration: sample.analysis.durationBeats })),
}));
const sample = async (page, id) => (await state(page)).samples.find(item => item.id === id);
const progress = async (page, id) => { const current = await sample(page, id); return current ? current.cycle * current.duration + current.position : -1; };
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
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
async function drawing(page, glyph = '❤') { await page.locator(`[data-drawing-stamp="${glyph}"]`).click(); await expect(page.locator('#generateDrawingMidi')).toBeEnabled(); }
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

test('native loop pads toggle independently and restarting one never duplicates or resets the other', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page);
  await expect(page.locator('[data-mixer-sample][aria-pressed="true"]')).toHaveCount(0);
  await expect(pad(page, 'heart')).toHaveAttribute('data-selected', 'true');
  await input(page, 'mixerStampBeats', 4); await input(page, 'mixerStampSpan', 12); await input(page, 'creativeTempo', 240);
  await page.locator('#mixerSampleProgram').selectOption('16');
  await page.locator('[data-stamp-loop="heart"]').check(); await page.locator('[data-stamp-loop="square"]').check(); await arm(page);
  const heart = await launch(page, () => pad(page, 'heart').click());
  const square = await launch(page, () => pad(page, 'square').click());
  await expect(pad(page, 'heart')).toHaveAttribute('aria-pressed', 'true'); await expect(pad(page, 'square')).toHaveAttribute('aria-pressed', 'true');
  await expect(pad(page, 'square')).toHaveAttribute('data-selected', 'true');
  expect((await state(page)).samples.map(item => item.id)).toEqual([heart.id, square.id]);
  await page.locator('#mixerStampFilter').fill('noise');
  await expect(pad(page, 'heart')).toBeVisible(); await expect(pad(page, 'square')).toBeVisible();
  await expect(pad(page, 'spiral')).toBeHidden(); await page.locator('#mixerStampFilter').fill('');
  await expect.poll(async () => (await sample(page, square.id))?.cycle).toBeGreaterThanOrEqual(1); await audible(page);
  const before = await progress(page, square.id); await pad(page, 'heart').click();
  await expect(pad(page, 'heart')).toHaveAttribute('aria-pressed', 'false');
  await expect(pad(page, 'square')).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).samples.map(item => item.id)).toEqual([square.id]); expect((await launches(page)).length).toBe(2);
  await expect.poll(() => progress(page, square.id)).toBeGreaterThan(before + .25);
  const remaining = await audible(page);
  const restarted = await launch(page, () => pad(page, 'heart').click()); expect(restarted.id).not.toBe(heart.id);
  expect((await state(page)).samples.map(item => item.id).sort()).toEqual([square.id, restarted.id].sort());
  await pad(page, 'heart').click(); expect((await launches(page)).length).toBe(3);
  expect((await state(page)).samples.map(item => item.id)).toEqual([square.id]);
  await pad(page, 'square').click(); await silent(page);
  expect((await state(page)).samples).toEqual([]); expect((await state(page)).playing).toBe(false);
  await expect(page.locator('[data-mixer-sample][aria-pressed="true"]')).toHaveCount(0);
  await testInfo.attach('remaining-pad-native-audio', { body: JSON.stringify(remaining), contentType: 'application/json' });
});

test('one-shot retrigger replaces only its pad and natural completion clears active state while retaining selection', async ({ page }) => {
  await open(page); await input(page, 'mixerStampBeats', 16); await input(page, 'creativeTempo', 240);
  await expect(page.locator('[data-stamp-loop="heart"]')).not.toBeChecked(); await expect(page.locator('[data-stamp-loop="square"]')).not.toBeChecked();
  const first = await launch(page, () => pad(page, 'heart').click()), other = await launch(page, () => pad(page, 'square').click());
  const again = await launch(page, () => pad(page, 'heart').click());
  expect(again.id).not.toBe(first.id); expect(again.loop).toBe(false);
  expect((await state(page)).samples.map(item => item.id).sort()).toEqual([other.id, again.id].sort());
  await expect(pad(page, 'heart')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).samples.length, { timeout: 10000 }).toBe(0);
  await expect(page.locator('[data-mixer-sample][aria-pressed="true"]')).toHaveCount(0);
  await expect(pad(page, 'heart')).toHaveAttribute('data-selected', 'true');
  expect((await launches(page)).length).toBe(3); expect((await state(page)).contexts).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('sent drawings become immutable thumbnail pads with individual loop, stop, replay and remove controls', async ({ page }) => {
  await open(page); await input(page, 'mixerStampBeats', 4); await input(page, 'mixerStampSpan', 12); await input(page, 'creativeTempo', 240);
  await page.locator('#mixerSampleLoop').check(); await drawing(page);
  const first = await launch(page, () => page.locator('#generateDrawingMidi').click());
  await expect(saved(page)).toHaveCount(1); const firstCard = saved(page).first();
  const firstKey = await firstCard.getAttribute('data-saved-pad'); expect(firstKey).toBeTruthy();
  const card = page.locator(`#mixerSavedPads [data-saved-pad="${firstKey}"]`);
  await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('[data-pad-loop]')).toBeChecked();
  expect(await card.locator('canvas').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
  const thumbnail = await card.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await drawing(page, 'spiral'); const second = await launch(page, () => page.locator('#generateDrawingMidi').click());
  await expect(saved(page)).toHaveCount(2); expect(second.bytes).not.toEqual(first.bytes);
  expect(await saved(page).last().locator('canvas').evaluate(canvas => canvas.toDataURL())).not.toBe(thumbnail);
  const secondKey = await saved(page).last().getAttribute('data-saved-pad');
  const other = page.locator(`#mixerSavedPads [data-saved-pad="${secondKey}"]`);
  await input(page, 'mixerStampBeats', 6); await input(page, 'mixerStampOffset', 12); await drawing(page, '⭐');
  expect(await card.locator('canvas').evaluate(canvas => canvas.toDataURL())).toBe(thumbnail);
  expect((await launches(page))[0].bytes).toEqual(first.bytes);
  await page.waitForFunction(id => { const current = __padsQA.engine.state.samples.find(item => item.id === id); return current && current.positionBeats > .1 && current.positionBeats < 2; }, first.id);
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

test('height and horizontal offset transform stamps and drawing exports, with matching native audio and graphics', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page);
  expect(await page.locator('#mixerStampBeats').evaluate(node => Number(node.min))).toBe(.25); expect(await page.locator('#mixerStampBeats').evaluate(node => Number(node.max))).toBe(64);
  await expect(page.locator('#mixerStampBeats')).toHaveAccessibleName(/height.*beats/i);
  await expect(page.locator('#mixerStampOffset')).toHaveAttribute('min', '-127'); await expect(page.locator('#mixerStampOffset')).toHaveAttribute('max', '127');
  await input(page, 'mixerStampSpan', 12); await input(page, 'mixerStampBeats', 2); await input(page, 'mixerStampOffset', 0);
  const original = await launch(page, () => pad(page, 'square').click()); await page.locator('#mixerStopSamples').click();
  await input(page, 'mixerStampBeats', 6); await input(page, 'mixerStampOffset', 12);
  const moved = await launch(page, () => pad(page, 'square').click()); transformed(original, moved, { stretch: 3, offset: 12 });
  await page.locator('#mixerStopSamples').click(); await drawing(page, 'wave');
  const pixels = await page.locator('#drawingCanvas').getAttribute('data-pixels');
  await input(page, 'mixerStampBeats', 2); await input(page, 'mixerStampOffset', 0);
  const draft = await launch(page, () => page.locator('#generateDrawingMidi').click());
  expect(Array.from(await download(page))).toEqual(draft.bytes); await page.locator('#mixerStopSamples').click();
  await input(page, 'mixerStampBeats', 6); await input(page, 'mixerStampOffset', 12); await input(page, 'creativeTempo', 300);
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleProgram').selectOption('16'); await arm(page);
  const sounding = await launch(page, () => page.locator('#generateDrawingMidi').click());
  transformed(draft, sounding, { stretch: 3, offset: 12 });
  const bytes = await download(page); expect(Array.from(bytes)).toEqual(sounding.bytes);
  expect(parseMidi(bytes).notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity }))).toEqual(sounding.notes);
  await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels', pixels);
  const expected = pitches(sounding.notes);
  await expect.poll(() => page.evaluate(id => [...new Set(__padsQA.notes.filter(note => note.type === 'noteOn' && note.sampleId === id).map(note => note.note))].sort((a, b) => a - b), sounding.id)).toEqual(expected);
  await expect.poll(() => page.evaluate(id => [...new Set(__padsQA.graphics.filter(note => note.type === 'noteOn' && note.sourceId === `sample:${id}`).map(note => note.note))].sort((a, b) => a - b), sounding.id)).toEqual(expected);
  const audio = await audible(page); await page.locator('#creativeStop').click(); await silent(page);
  await testInfo.attach('transformed-drawing-native-audio', { body: JSON.stringify(audio), contentType: 'application/json' });
});

test('tapping a pending file pad again cancels its fetch without stopping another loop or launching later', async ({ page }) => {
  test.setTimeout(60000); await open(page); await page.locator('[data-stamp-loop="square"]').check();
  const other = await launch(page, () => pad(page, 'square').click());
  let ready, release, done, pending;
  const started = new Promise(resolve => { ready = resolve; }), gate = new Promise(resolve => { release = resolve; }), finished = new Promise(resolve => { done = resolve; });
  const file = pad(page, 'black-pattern-3-beat-funnel-128');
  await page.route('**/assets/midiphoria/midi/black-pattern-3-beat-funnel-128.mid', async route => {
    pending = route.request(); const response = await route.fetch(); ready(); await gate;
    try { await route.fulfill({ response }); } finally { done(); }
  });
  try {
    await file.click(); await started;
    await expect(file).toHaveAttribute('data-pending', 'true'); await expect(file).toHaveAttribute('aria-busy', 'true');
    await expect(file).toHaveAttribute('aria-pressed', 'false'); const before = await progress(page, other.id);
    await file.click(); release(); await finished;
    await expect.poll(() => Boolean(pending.failure()), { message: 'canceled pad fetch was aborted' }).toBe(true);
    await expect(file).not.toHaveAttribute('data-pending', 'true'); await expect(file).not.toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => progress(page, other.id)).toBeGreaterThan(before + .25);
    await expect(pad(page, 'square')).toHaveAttribute('aria-pressed', 'true');
    expect((await launches(page)).map(item => item.id)).toEqual([other.id]); expect((await state(page)).samples.map(item => item.id)).toEqual([other.id]);
    expect((await state(page)).contexts).toBe(0); await page.locator('#creativeStop').click();
  } finally { release(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`pad controls, saved loops and geometry are reachable by touch and keyboard at ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage(), failures = []; page.on('pageerror', error => failures.push(error.message));
    try {
      await open(page); await page.locator('#mixerSampleLoop').check(); await drawing(page);
      await launch(page, () => page.locator('#generateDrawingMidi').click()); const card = saved(page).first();
      for (const control of [pad(page, 'heart'), card.locator('[data-pad-play]'), card.locator('[data-pad-loop]').locator('..'), card.locator('[data-pad-remove]')]) {
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible(); const box = await control.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      for (const id of ['mixerStampBeats', 'mixerStampOffset']) {
        const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      await card.locator('[data-pad-play]').focus(); await page.keyboard.press('Space');
      await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed', 'false');
      await card.locator('[data-pad-loop]').focus(); await page.keyboard.press('Space'); await expect(card.locator('[data-pad-loop]')).not.toBeChecked();
      await input(page, 'mixerStampOffset', 0); await page.locator('#mixerStampOffset').focus(); await page.keyboard.press('ArrowRight');
      await expect(page.locator('#mixerStampOffset')).toHaveValue('1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.locator('#mixerSavedPads').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect((await state(page)).contexts).toBe(0); expect(failures).toEqual([]);
      await saved(page).first().scrollIntoViewIfNeeded(); await testInfo.attach(`saved-pads-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    } finally { await context.close(); }
  });
}
