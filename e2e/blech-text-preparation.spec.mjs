import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const failures = new WeakMap();
test.beforeEach(({ page }) => { failures.set(page, []); page.on('pageerror', error => failures.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(failures.get(page), 'uncaught browser errors').toEqual([]));

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__textQA = { engine: null, preview: null, contexts: [], notes: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __textQA.contexts.push(this); } };
  });
  // Observe real parsed preview notes and native playback; do not replace the
  // text generator, its MIDI bytes, synthesis, routing or transport clocks.
  await page.route('**/src/instruments/blech-midi/blech-midi-generator-preview.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaTextPreview = drawGeneratorPreview;
      drawGeneratorPreview = function(canvas, score, ...args) {
        if (canvas.id === 'blechTextPreview') __textQA.preview = score ? {
          duration: score.durationBeats,
          notes: score.notes.map(({note, beat, duration, velocity}) => ({note, beat, duration, velocity}))
        } : null;
        return qaTextPreview.call(this, canvas, score, ...args);
      };` });
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaTextVolume = MidiMixerEngine.prototype.setVolume, qaTextSeen = new WeakSet();
      MidiMixerEngine.prototype.setVolume = function(...args) {
        __textQA.engine = this;
        if (!qaTextSeen.has(this)) { qaTextSeen.add(this); this.subscribeNotes(notes => __textQA.notes.push(...notes)); }
        return qaTextVolume.apply(this, args);
      };` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechTextDrop')).toBeEnabled();
  await expect.poll(() => page.locator('#blackSongSelect option').count()).toBeGreaterThan(100);
  await tab(page, 'text');
}

async function tab(page, name) {
  await page.locator(`#blechTab-${name}`).click();
  await expect(page.locator(`#blechPanel-${name}`)).toBeVisible();
}
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const preview = page => page.evaluate(() => __textQA.preview);
const samples = page => page.evaluate(() => __textQA.engine.state.samples.map(sample => ({
  id: sample.id, name: sample.name, loop: sample.loop, position: sample.positionBeats, cycle: sample.cycle,
  duration: sample.analysis.durationBeats,
  notes: sample.analysis.notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity })),
})));
const row = (page, id) => page.locator(`#blechLiveLayers [data-sample-id="${id}"]`);
const pitchBounds = score => [Math.min(...score.notes.map(note => note.note)), Math.max(...score.notes.map(note => note.note))];
async function drop(page) {
  const before = new Set((await samples(page)).map(sample => sample.id));
  await page.locator('#blechTextDrop').click();
  await expect.poll(async () => (await samples(page)).filter(sample => !before.has(sample.id)).length).toBe(1);
  return (await samples(page)).find(sample => !before.has(sample.id));
}
async function expectSilentPreparation(page) {
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __textQA.contexts.length)).toBe(0);
}

test('text preparation maps keyboard width, position and total duration to the exact dropped MIDI without starting audio', async ({ page }) => {
  await open(page);
  await expect(page.locator('#drawingShapeControls')).toBeHidden();
  await page.locator('#blechTextMessage').fill('');
  await page.locator('#blechTextMessage').pressSequentially('hello world');
  await expect(page.locator('#blechTextMessage')).toHaveValue('hello world');
  expect(await samples(page)).toEqual([]); await expectSilentPreparation(page);

  await page.locator('#blechTextMessage').fill('L');
  await input(page, 'blechTextSpan', 24); await input(page, 'blechTextPosition', 24); await input(page, 'blechTextBeats', 8);
  const prepared = await preview(page);
  expect(prepared.duration).toBe(8); expect(pitchBounds(prepared)).toEqual([24, 47]);
  await input(page, 'blechTextPosition', 36);
  const shifted = await preview(page);
  expect(shifted.notes).toEqual(prepared.notes.map(note => ({ ...note, note: note.note + 12 })));
  await input(page, 'blechTextBeats', 16);
  const stretched = await preview(page);
  expect(stretched.duration).toBe(16);
  expect(stretched.notes).toEqual(shifted.notes.map(note => ({ ...note, beat: note.beat * 2, duration: note.duration * 2 })));
  await input(page, 'blechTextSpan', 48);
  expect(pitchBounds(await preview(page))).toEqual([36, 83]);
  await input(page, 'blechTextSpan', 128);
  await expect(page.locator('#blechTextPosition')).toBeDisabled();
  await expect(page.locator('#blechTextPositionOut')).toContainText('Full keyboard');
  expect(pitchBounds(await preview(page))).toEqual([0, 127]);

  await input(page, 'blechTextSpan', 48); await input(page, 'blechTextPosition', 40);
  await page.locator('#blechTextMessage').fill('HI');
  await input(page, 'blechTextBeats', 8);
  const together = await preview(page);
  await page.locator('#blechTextMode').selectOption('letter');
  await expect.poll(async () => (await preview(page)).notes).not.toEqual(together.notes);
  const sequential = await preview(page);
  expect(sequential.duration).toBe(together.duration);
  expect(await samples(page)).toEqual([]);
  const launched = await drop(page);
  expect(launched).toMatchObject({ name: 'Text · HI', loop: false, duration: sequential.duration, notes: sequential.notes });
  await tab(page, 'stamps');
  await expect(page.locator('#mixerSavedPads [data-pad-play]').getByText('Text · HI', { exact: true })).toBeVisible();
  await expectSilentPreparation(page);
});

test('text keeps its own loop and geometry after drawing and file stamp edits, while invalid drafts stay local', async ({ page }) => {
  await open(page); await tab(page, 'drawing');
  await input(page, 'mixerStampSpan', 128); await input(page, 'mixerStampBeats', 25.5);
  await page.locator('#mixerSampleLoop').check();
  await tab(page, 'text');
  await expect(page.locator('#blechTextSpan')).toHaveValue('48'); await expect(page.locator('#blechTextBeats')).toHaveValue('8');
  await expect(page.locator('#blechTextLoop')).not.toBeChecked();
  await input(page, 'blechTextBeats', 64);
  const oneShot = await drop(page); expect(oneShot.loop).toBe(false);
  await page.locator('#blechTextLoop').check();
  const loop = await drop(page); expect(loop.loop).toBe(true);
  await page.locator('#blechTextMessage').fill('NEW'); await input(page, 'blechTextPosition', 12);
  await page.locator('#blechTextLoop').uncheck();
  expect((await samples(page)).find(sample => sample.id === loop.id)).toMatchObject({ loop: true, notes: loop.notes });
  await tab(page, 'drawing'); await page.locator('#mixerSampleLoop').uncheck();
  await tab(page, 'stamps'); await page.locator('[data-mixer-sample="mirror-spiral"]').click();
  await expect(page.locator('#mixerStampSpan')).toBeDisabled();
  await tab(page, 'text');
  await expect(page.locator('#blechTextSpan')).toBeEnabled(); await expect(page.locator('#blechTextBeats')).toBeEnabled();
  await expect(page.locator('#blechTextPosition')).toHaveValue('12');
  await expect(page.locator('#blechTextMessage')).toHaveValue('NEW');
  expect((await samples(page)).find(sample => sample.id === loop.id)).toMatchObject({ loop: true, notes: loop.notes });
  const before = (await samples(page)).map(sample => sample.id);
  for (const message of ['', '🦄']) {
    await page.locator('#blechTextMessage').fill(message);
    await expect(page.locator('#blechTextDrop')).toBeDisabled();
    await expect(page.locator('#blechTextStatus')).not.toBeEmpty();
    expect(await preview(page)).toBeNull();
    expect((await samples(page)).map(sample => sample.id)).toEqual(before);
  }
  await page.locator('#blechTextMessage').fill('A🦄');
  await expect(page.locator('#blechTextDrop')).toBeEnabled();
  await expect(page.locator('#blechTextStatus')).toContainText('🦄');
  await row(page, oneShot.id).locator('[data-layer-stop]').click();
  await expect(row(page, oneShot.id)).toHaveCount(0);
  expect((await samples(page)).find(sample => sample.id === loop.id)).toMatchObject({ loop: true, notes: loop.notes });
  await expectSilentPreparation(page);
});

test('native text loops sound independently and stopping one releases only its notes', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page);
  await page.locator('#blechTextMessage').fill('H'); await input(page, 'blechTextBeats', 2);
  await page.locator('#blechTextLoop').check();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  const first = await drop(page);
  await page.locator('#blechTextMessage').fill('A');
  const second = await drop(page);
  const attacks = id => page.evaluate(id => __textQA.notes.filter(note => note.sampleId === id && note.type === 'noteOn').length, id);
  await expect.poll(() => attacks(first.id)).toBeGreaterThan(4);
  await expect.poll(() => attacks(second.id)).toBeGreaterThan(4);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001); expect(summary.clippedSamples).toBe(0);
  await row(page, first.id).locator('[data-layer-stop]').click();
  await expect(row(page, first.id)).toHaveCount(0);
  await page.waitForTimeout(150);
  const firstCount = await attacks(first.id), secondCount = await attacks(second.id);
  await expect.poll(() => attacks(second.id)).toBeGreaterThan(secondCount);
  expect(await attacks(first.id)).toBe(firstCount);
  expect((await samples(page)).map(sample => sample.id)).toEqual([second.id]);
  await row(page, second.id).locator('[data-layer-stop]').click();
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 12000 }).toBeLessThan(.0001);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => __textQA.contexts.length)).toBe(1);
  await testInfo.attach('text-native-audio', { body: JSON.stringify(summary), contentType: 'application/json' });
});

test('prepared text, geometry and layer recovery stay reachable across laptop and phone layouts', async ({ page }, testInfo) => {
  await open(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.locator('#blechTextMessage').fill('HELLO ❤');
    for (const selector of ['#blechTextMessage', '#blechTextMode', '#blechTextPreview', '#blechTextPosition', '#blechTextLoop', '#blechTextDrop']) {
      const control = page.locator(selector); await control.scrollIntoViewIfNeeded();
      expect(await control.evaluate(node => {
        const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return node === hit || node.contains(hit);
      }), `${selector} is reachable at ${viewport.width} × ${viewport.height}`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const sample = await drop(page);
    await row(page, sample.id).locator('[data-layer-pause]').click();
    await expect(row(page, sample.id)).toHaveAttribute('data-paused', 'true');
    await row(page, sample.id).locator('[data-layer-stop]').click();
    await expect(row(page, sample.id)).toHaveCount(0);
    await page.locator('#blechTextMessage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`text-${viewport.width}.png`) });
  }
  await expectSilentPreparation(page);
});
