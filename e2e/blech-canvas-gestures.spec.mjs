import { test, expect } from '@playwright/test';

// Observe the real app's clock and source records without replacing gesture,
// scheduling, or MIDI processing behavior.
async function open(page) {
  await page.addInitScript(() => {
    globalThis.__gestureQA = { pointers: [] };
    for (const type of ['pointerdown', 'pointerup']) document.addEventListener(type, event => {
      if (event.target.matches?.('.blech-spigot-paint')) __gestureQA.pointers.push({ type, time: performance.now() });
    }, true);
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeGestureVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){__gestureQA.engine=this;return observeGestureVolume.apply(this,args);};` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-spigots.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace('export function mountBlechSpigots(', 'function observedMountBlechSpigots(');
    await route.fulfill({ response, body: `${source}\nexport function mountBlechSpigots(viewport,options){__gestureQA.layers=options.getLayers;__gestureQA.prepared=options.getPreparedScore;__gestureQA.geometry=()=>{const rect=viewport.getBoundingClientRect();return {...spigotGeometry(rect.width,rect.height,options.getTempo(),options.getView()),left:rect.left,top:rect.top};};__gestureQA.ui=observedMountBlechSpigots(viewport,options);return __gestureQA.ui;}` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('[data-spigot-mode="draw"]')).toBeVisible();
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await number(page, '#creativeTempoExact', 120);
  await page.locator('[data-spigot-mode="draw"]').click();
}

async function number(page, selector, value) {
  await page.locator(selector).fill(String(value)); await page.locator(selector).press('Tab');
}
const layers = page => page.evaluate(() => __gestureQA.layers().map(layer => ({
  id: layer.id, sampleId: layer.sampleId, name: layer.name, settings: layer.settings,
  duration: layer.score.analysis.durationBeats, playing: layer.playing, paused: layer.paused,
  notes: layer.score.analysis.notes.map(note => ({ note: note.note, beat: note.beat, duration: note.duration })),
})));
const clock = page => page.evaluate(() => ({
  beat: __gestureQA.engine.state.sampleBeat, tempo: __gestureQA.engine.state.tempo,
  samples: __gestureQA.engine.state.samples.map(sample => ({
    id: sample.id, position: sample.positionBeats, cycle: sample.cycle, paused: sample.paused,
    muted: sample.muted, hold: sample.hold, loop: sample.loop, pending: sample.pendingBeats,
  })),
}));
const row = (page, id) => page.locator(`.blech-live-layer[data-spigot-id="${id}"]`);
const count = page => page.locator('#blechNotesPlayed').evaluate(node => Number(node.value.replaceAll(',', '')));
async function point(page, x = .5, y = .5) {
  const rect = await page.locator('.blech-spigot-paint').boundingBox();
  return { x: rect.x + rect.width * x, y: rect.y + rect.height * y };
}
async function scorePoint(page, pitch, delayBeats) {
  return page.evaluate(({ pitch, delayBeats }) => {
    const g = __gestureQA.geometry(), key = g.layout[pitch];
    return { x: g.left + (key.x + key.width / 2) * g.width, y: g.top + g.present - delayBeats * g.pixelsPerBeat };
  }, { pitch, delayBeats });
}
async function drawLine(page, start, end) {
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
}
const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test('real double-click replaces only its two click phrases with one held layer', async ({ page }) => {
  await open(page);
  const first = await point(page, .3, .6);
  await page.mouse.click(first.x, first.y);
  const previous = (await layers(page))[0];
  const held = await point(page, .7, .6);
  await page.mouse.dblclick(held.x, held.y);
  await expect.poll(async () => (await layers(page)).filter(layer => layer.settings.hold).length).toBe(1);
  const result = await layers(page);
  expect(result).toHaveLength(2);
  expect(result.find(layer => layer.id === previous.id)).toEqual(previous);
  expect(result.find(layer => layer.settings.hold)).toMatchObject({ name: 'Held note', settings: { hold: true, loop: false } });
  await expect(page.locator('.blech-spigot-grip').first()).toBeHidden();
  await row(page, previous.id).locator('[data-layer-select]').click();
  await expect(page.locator('.blech-spigot-overlay')).toHaveAttribute('data-mode', 'select');
  await expect(page.locator('[data-spigot-resize="right"]')).toBeVisible();
  await expect(page.locator('.blech-spigot-rotate')).toBeVisible();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('click, beat-long hold and fast pitch gesture retain their performed timing as independent loops', async ({ page }) => {
  await open(page);
  const quick = await point(page, .2, .7);
  await page.mouse.click(quick.x, quick.y);
  const short = (await layers(page))[0];
  expect(short.duration).toBeCloseTo(1 / 16, 5);
  expect(short.notes).toHaveLength(1);
  expect(short.notes[0].duration).toBeCloseTo(short.duration, 5);
  expect(short.settings.loop).toBe(true);

  const held = await point(page, .45, .7);
  await page.mouse.move(held.x, held.y); await page.mouse.down();
  const elapsed = await page.evaluate(() => performance.now() - __gestureQA.pointers.at(-1).time);
  await page.waitForTimeout(Math.max(0, 500 - elapsed)); await page.mouse.up();
  const heldBeats = await page.evaluate(() => {
    const [start, end] = __gestureQA.pointers.slice(-2);
    return (end.time - start.time) / 1000 * __gestureQA.engine.state.tempo / 60;
  });
  const phrase = (await layers(page))[1];
  expect(phrase.notes).toHaveLength(1);
  expect(heldBeats).toBeGreaterThanOrEqual(.95);
  expect(Math.abs(phrase.duration - heldBeats)).toBeLessThan(.1);
  expect(phrase.notes[0].duration).toBeCloseTo(phrase.duration, 5);
  expect(phrase.settings.loop).toBe(true);

  const a = await point(page, .65, .7), b = await point(page, .79, .7);
  await drawLine(page, a, b);
  const result = await layers(page), swept = result[2];
  expect(result).toHaveLength(3);
  expect(result[0]).toEqual(short); expect(result[1]).toEqual(phrase);
  expect(swept.notes.length).toBeGreaterThan(6);
  expect(new Set(swept.notes.map(note => note.note)).size).toBeGreaterThan(6);
  for (let i = 1; i < swept.notes.length; i++) expect(swept.notes[i].beat).toBeGreaterThan(swept.notes[i - 1].beat);
  expect(swept.notes.every(note => note.duration > 0 && note.beat + note.duration <= swept.duration + .003)).toBe(true);
  expect(swept.settings.loop).toBe(true);
  await expect(page.locator('.blech-live-layer[data-spigot-id]')).toHaveCount(3);
  await expect(page.locator('[data-spigot-mode="draw"]')).toHaveAttribute('aria-pressed', 'true');
});

test('held note counts once beyond score length and supports independent pause, mute and stop', async ({ page }) => {
  await open(page);
  const at = await point(page, .5, .97);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(async () => (await layers(page)).filter(layer => layer.settings.hold).length).toBe(1);
  const held = (await layers(page))[0], strip = row(page, held.id);
  await expect.poll(() => count(page)).toBe(1);
  await page.waitForTimeout(1100); // More than two lengths of this one-beat source at 120 BPM.
  expect(await count(page)).toBe(1);
  const ongoing = (await clock(page)).samples[0];
  expect(ongoing).toMatchObject({ id: held.sampleId, hold: true, loop: false, cycle: 0 });

  await strip.locator('[data-layer-pause]').click();
  await expect.poll(async () => (await clock(page)).samples[0]?.paused).toBe(true);
  const paused = (await clock(page)).samples[0];
  await page.waitForTimeout(250);
  expect((await clock(page)).samples[0]).toEqual(paused); expect(await count(page)).toBe(1);
  await strip.locator('[data-layer-pause]').click();
  await expect.poll(async () => (await clock(page)).samples[0]?.paused).toBe(false);
  await page.waitForTimeout(600); expect(await count(page)).toBe(1);

  await strip.locator('[data-layer-mute]').click();
  await expect(strip.locator('[data-layer-mute]')).toHaveAttribute('aria-pressed', 'true');
  expect((await clock(page)).samples[0]).toMatchObject({ muted: true, paused: false, hold: true });
  await page.waitForTimeout(300); expect(await count(page)).toBe(1);
  await strip.locator('[data-layer-mute]').click();
  await expect(strip.locator('[data-layer-mute]')).toHaveAttribute('aria-pressed', 'false');
  expect((await clock(page)).samples[0].muted).toBe(false);
  await page.locator('#creativeStop').click();
  expect((await clock(page)).samples).toEqual([]);
  await page.waitForTimeout(150); expect(await count(page)).toBe(1);
  await strip.locator('[data-layer-stop]').click();
  expect(await layers(page)).toEqual([]);
  await expect(page.locator('.blech-live-layer[data-spigot-id]')).toHaveCount(0);
});

test('eraser removes touched notes only from the selected overlapping phrase', async ({ page }) => {
  await open(page);
  const a = await point(page, .4, .7), b = await point(page, .52, .7);
  await drawLine(page, a, b); await drawLine(page, a, b);
  const original = await layers(page);
  expect(original).toHaveLength(2);
  const target = original[1], firstNote = target.notes[0];
  await row(page, target.id).locator('[data-layer-select]').click();
  await page.locator('[data-spigot-mode="erase"]').click();
  const erase = await scorePoint(page, firstNote.note, target.settings.delayBeats + firstNote.beat + firstNote.duration / 2);
  await page.mouse.click(erase.x, erase.y);
  const after = await layers(page);
  expect(after).toHaveLength(2);
  expect(after[0]).toEqual(original[0]);
  expect(after[1].id).toBe(target.id); expect(after[1].sampleId).toBe(target.sampleId);
  expect(after[1].notes.length).toBeGreaterThan(0);
  expect(after[1].notes.length).toBeLessThan(target.notes.length);
  expect(after[1].notes.some(note => note.note === firstNote.note)).toBe(false);
  await expect(row(page, target.id)).toHaveAttribute('data-selected', 'true');
});

test('stamp thumbnail grid places the selected artwork while Math remains the open generator', async ({ page }) => {
  await open(page);
  await number(page, '#blechDropWidth', 25); await number(page, '#blechDropHeight', 2);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', 'math');
  await page.locator('[data-spigot-mode="stamp"]').click();
  const grid = page.locator('.blech-spigot-stamp-grid');
  await expect(grid).toBeVisible();
  expect(await grid.locator('[data-stamp-id]').count()).toBeGreaterThan(20);
  const heart = grid.locator('[data-stamp-id="heart"]');
  await expect(heart.locator('canvas')).toBeVisible();
  await heart.click();
  await expect(page.locator('.blech-spigot-overlay')).toHaveAttribute('data-mode', 'stamp');
  await expect(grid).toBeHidden();
  const expectedCount = await page.evaluate(() => {
    const score = __gestureQA.prepared().score;
    return score.noteCount ?? score.analysis?.noteCount ?? score.notes.length;
  });
  const at = await point(page, .5, .7); await page.mouse.click(at.x, at.y);
  const [stamped] = await layers(page);
  expect(stamped.name).toMatch(/heart/i);
  expect(stamped.notes).toHaveLength(expectedCount);
  expect(new Set(stamped.notes.map(note => note.note)).size).toBeGreaterThan(5);
  expect(new Set(stamped.notes.map(note => note.beat)).size).toBeGreaterThan(1);
  expect(new Set(stamped.notes.map(note => note.duration)).size).toBeGreaterThan(1);
  expect(stamped.settings.source).toBe('frames');
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', 'math');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});
