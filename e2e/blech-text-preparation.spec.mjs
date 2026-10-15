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
  if (['drawing','stamps','art','scripts','sequence'].includes(name)) await page.locator('#blechTab-frames').click();
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
  paused: sample.paused, pendingReplacement: Boolean(sample.pendingReplacement),
  duration: sample.analysis.durationBeats,
  notes: sample.analysis.notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity })),
})));
const row = (page, id) => page.locator(`#blechLiveLayers [data-sample-id="${id}"]`);
const sample = async (page, id) => (await samples(page)).find(item => item.id === id);
const progress = item => item.cycle * item.duration + item.position;
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
  await page.locator('#blechDropLoop').click();
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
  await tab(page, 'drawing'); await page.locator('#blechDropOnce').click();
  await tab(page, 'stamps'); await page.locator('#blechStampPicker summary').click(); await page.locator('#blechStampPicker [data-stamp-id="mirror-spiral"]').click(); await page.locator('#blechDropSend').click();
  await expect(page.locator('#mixerStampSpan')).toBeDisabled();
  await expect.poll(async () => (await samples(page)).length).toBe(3);
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

test('typing Enter, automatic word wrapping, letter size and Clear prepare exactly the visible lines', async ({ page }) => {
  await open(page);
  const message = page.getByRole('textbox', { name: 'Write text', exact: true });
  await message.fill('HI ALL YOU'); await message.press('Enter'); await message.pressSequentially('YES');
  await expect(message).toHaveValue('HI ALL YOU\nYES');
  await input(page, 'blechTextSpan', 35);
  const lines = page.locator('#blechTextLines li > span');
  await expect(lines).toHaveText(['HI ALL', 'YOU', 'YES']);
  expect(await samples(page)).toEqual([]);
  await page.locator('#blechTextFit').uncheck(); await input(page, 'blechTextScale', 2);
  await expect(lines).toHaveText(['HI', 'ALL', 'YOU', 'YES']);
  await expect(page.locator('#blechTextScaleOut')).toContainText('10 keys');
  await message.fill('L'); await input(page, 'blechTextPosition', 40);
  await page.locator('[name="blechTextAlign"][value="left"]').check();
  await expect.poll(async () => pitchBounds(await preview(page))).toEqual([40, 49]);
  const left = await preview(page);
  await page.locator('[name="blechTextAlign"][value="right"]').check();
  await expect.poll(async () => pitchBounds(await preview(page))).toEqual([65, 74]);
  expect((await preview(page)).notes).toEqual(left.notes.map(note => ({ ...note, note: note.note + 25 })));
  await page.locator('#blechTextLoop').check();
  const snapshot = await preview(page), launched = await drop(page);
  expect(launched).toMatchObject({ duration: snapshot.duration, notes: snapshot.notes });
  await page.locator('#blechTextClear').click();
  await expect(message).toHaveValue(''); await expect(message).toBeFocused();
  await expect(lines).toHaveCount(0); expect(await preview(page)).toBeNull();
  await expect(page.locator('#blechTextDrop')).toBeDisabled();
  expect(await sample(page, launched.id)).toMatchObject({ id: launched.id, loop: true, notes: launched.notes });
  await message.fill('A\n\nB');
  await expect(lines).toHaveText(['A', '(blank line)', 'B']);
  await expectSilentPreparation(page);
});

test('editing one live text layer queues its next loop and paused edits retain that layer without affecting another', async ({ page }) => {
  await open(page); await input(page, 'creativeTempo', 60);
  await page.locator('#blechTextMessage').fill('FIRST'); await input(page, 'blechTextBeats', 4);
  await page.locator('#blechTextLoop').check();
  const first = await drop(page);
  await page.locator('#blechTextMessage').fill('OTHER');
  const other = await drop(page);
  await row(page, first.id).locator('[data-layer-edit]').click();
  await expect(page.locator('#blechTextMessage')).toHaveValue('FIRST');
  await expect(page.locator('#blechTextApply')).toHaveText('Apply next loop');
  await page.locator('#blechTextMessage').fill('RESIZED');
  await input(page, 'blechTextSpan', 24); await input(page, 'blechTextPosition', 12); await input(page, 'blechTextBeats', 8);
  const replacement = await preview(page);
  expect(await sample(page, first.id)).toMatchObject({ duration: first.duration, notes: first.notes });
  // Apply just after a wrap, leaving a full pass in which to observe the old
  // score and prove the pending update is not an immediate restart. Poll
  // faster than a beat so the default one-second interval cannot miss every
  // early-loop observation window at 60 BPM.
  await expect.poll(async () => { const current = await sample(page, first.id); return current.position > .1 && current.position < .7; }, { timeout: 6000, intervals: [50] }).toBe(true);
  const before = await sample(page, first.id), otherBefore = await sample(page, other.id);
  await page.locator('#blechTextApply').click();
  expect(await sample(page, first.id)).toMatchObject({ id: first.id, pendingReplacement: true, duration: first.duration, notes: first.notes });
  expect(progress(await sample(page, first.id))).toBeGreaterThanOrEqual(progress(before));
  await expect(row(page, first.id)).toContainText('Update next loop');
  await expect.poll(async () => (await sample(page, first.id)).notes, { timeout: 6000 }).toEqual(replacement.notes);
  expect(await sample(page, first.id)).toMatchObject({ id: first.id, duration: 8, name: 'Text · RESIZED', pendingReplacement: false });
  expect(await sample(page, other.id)).toMatchObject({ id: other.id, notes: other.notes, duration: other.duration });
  expect(progress(await sample(page, other.id))).toBeGreaterThan(progress(otherBefore));
  expect(await samples(page)).toHaveLength(2);

  // Turning Loop off cancels a queued edit and restores the pad's committed
  // document, rather than silently replaying an update which never sounded.
  await page.locator('#blechTextMessage').fill('DISCARD'); await input(page, 'blechTextBeats', 16);
  await page.locator('#blechTextApply').click();
  expect(await sample(page, first.id)).toMatchObject({ pendingReplacement: true });
  await row(page, first.id).getByRole('checkbox').uncheck();
  await expect.poll(async () => (await sample(page, first.id)).pendingReplacement).toBe(false);
  expect(await sample(page, first.id)).toMatchObject({ notes: replacement.notes, duration: 8 });
  await row(page, first.id).locator('[data-layer-edit]').click();
  await expect(page.locator('#blechTextMessage')).toHaveValue('RESIZED');
  await expect(page.locator('#blechTextBeats')).toHaveValue('8');
  await row(page, first.id).getByRole('checkbox').check();
  await row(page, first.id).locator('[data-layer-pause]').click();
  await row(page, first.id).locator('[data-layer-edit]').click();
  await expect(page.locator('#blechTextApply')).toHaveText('Apply changes');
  await page.locator('#blechTextMessage').fill('PAUSED\nWORD'); await input(page, 'blechTextBeats', 2);
  const pausedScore = await preview(page);
  await page.locator('#blechTextApply').click();
  await expect.poll(async () => (await sample(page, first.id)).notes).toEqual(pausedScore.notes);
  expect(await sample(page, first.id)).toMatchObject({ id: first.id, paused: true, duration: 2 });
  await page.locator('#blechTextClear').click();
  expect(await sample(page, first.id)).toMatchObject({ paused: true, notes: pausedScore.notes });
  await page.locator('#blechTextDone').click(); await expect(page.locator('#blechTextApply')).toBeHidden();
  await tab(page, 'stamps');
  await page.locator('#mixerSavedPads').getByRole('button', { name: 'Edit Text · PAUSED / WORD', exact: true }).click();
  await expect(page.locator('#blechPanel-text')).toBeVisible();
  await expect(page.locator('#blechTextMessage')).toHaveValue('PAUSED\nWORD');
  await expect(page.locator('#blechTextSpan')).toHaveValue('24');
  await expect(page.locator('#blechTextPosition')).toHaveValue('12');
  await row(page, first.id).locator('[data-layer-pause]').click();
  await expect.poll(async () => { const current = await sample(page, first.id); return current.position > .1 && current.position < .5; }, { intervals: [50] }).toBe(true);
  await page.locator('#blechTextMessage').fill('DISCARD STOP'); await input(page, 'blechTextBeats', 16);
  await page.locator('#blechTextApply').click();
  expect(await sample(page, first.id)).toMatchObject({ pendingReplacement: true });
  await row(page, first.id).locator('[data-layer-stop]').click();
  expect((await samples(page)).map(item => item.id)).toEqual([other.id]);
  await tab(page, 'stamps');
  await page.locator('#mixerSavedPads').getByRole('button', { name: 'Text · PAUSED / WORD', exact: true }).click();
  await expect.poll(async () => (await samples(page)).length).toBe(2);
  const replay = (await samples(page)).find(item => item.id !== other.id);
  expect(replay.id).not.toBe(first.id);
  expect(replay).toMatchObject({ name: 'Text · PAUSED / WORD', notes: pausedScore.notes, duration: 2, loop: true, paused: false });
  expect(await sample(page, other.id)).toMatchObject({ notes: other.notes, duration: other.duration });
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
  await row(page, first.id).locator('[data-layer-edit]').click();
  await input(page, 'blechTextSpan', 24); await input(page, 'blechTextPosition', 100);
  const replacement = await preview(page);
  await page.locator('#blechTextApply').click();
  await expect.poll(async () => (await sample(page, first.id)).notes, { timeout: 6000 }).toEqual(replacement.notes);
  expect((await samples(page)).map(item => item.id)).toEqual([first.id, second.id]);
  const editedStart = await page.evaluate(() => __textQA.notes.length);
  await expect.poll(() => page.evaluate(({ id, start }) => __textQA.notes.slice(start).filter(note => note.sampleId === id && note.type === 'noteOn' && note.note >= 100).length,
    { id: first.id, start: editedStart })).toBeGreaterThan(4);
  const afterEdit = await attacks(second.id);
  await expect.poll(() => attacks(second.id)).toBeGreaterThan(afterEdit);
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
  await page.locator('#blechTextFit').uncheck();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.locator('#blechTextMessage').fill('HELLO ❤');
    for (const selector of ['#blechTextMessage', '#blechTextClear', '#blechTextMode', '#blechTextFit', '#blechTextLines', '#blechTextPreview', '#blechTextScale', '#blechTextPosition', '#blechTextLoop', '#blechTextDrop']) {
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
    await row(page, sample.id).locator('[data-layer-edit]').click();
    await page.locator('#blechTextApply').scrollIntoViewIfNeeded();
    await expect(page.locator('#blechTextApply')).toBeVisible();
    await page.locator('#blechTextDone').click();
    await row(page, sample.id).locator('[data-layer-stop]').click();
    await expect(row(page, sample.id)).toHaveCount(0);
    await page.locator('#blechTextMessage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`text-${viewport.width}.png`) });
  }
  await expectSilentPreparation(page);
});
