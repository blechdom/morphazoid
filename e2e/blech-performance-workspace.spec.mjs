import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const tabs = ['files', 'stamps', 'math', 'drawing', 'frames', 'text', 'automata', 'art', 'visuals', 'sound', 'info'];
const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__workspaceQA = { engine: null, player: null, contexts: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __workspaceQA.contexts.push(this); } };
  });
  // Retain production state without changing its rendering or scheduling.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeWorkspaceVolume=MidiMixerEngine.prototype.setVolume; MidiMixerEngine.prototype.setVolume=function(...args){__workspaceQA.engine=this;return observeWorkspaceVolume.apply(this,args);};` });
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeWorkspacePublish=MidiphoriaPlayer.prototype._publish; MidiphoriaPlayer.prototype._publish=function(...args){__workspaceQA.player=this;return observeWorkspacePublish.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechMathDrop')).toBeEnabled();
  await expect.poll(() => page.locator('#blackSongSelect option').count()).toBeGreaterThan(100);
}

async function tab(page, id) {
  await page.locator(`#blechTab-${id}`).click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', id);
  await expect(page.locator(`#blechPanel-${id}`)).toBeVisible();
  await expect(page.locator('#blackMidiViewport')).toBeVisible();
}
const stage = page => page.locator('.midiphoria-black-stage');
const samples = page => page.evaluate(() => __workspaceQA.engine.state.samples.map(sample => ({ id: sample.id, loop: sample.loop, position: sample.positionBeats, cycle: sample.cycle, name: sample.name, notes: sample.analysis.noteCount, duration: sample.analysis.durationBeats })));
const sources = page => stage(page).evaluate(node => JSON.parse(node.dataset.liveSources || '[]'));
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 12000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001); expect(summary.clippedSamples).toBe(0);
}
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

test('one persistent falling stage and keyboard-operated tabs start without audio or playback', async ({ page }) => {
  await open(page);
  await expect(page.locator('#blechMidiTitle')).toHaveText('BLECH MIDI');
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveCount(0);
  await expect(page.locator('#blackSongSelect')).toHaveValue('');
  const before = await page.locator('#blackMidiViewport').boundingBox();
  await page.locator('#blechTab-files').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#blechTab-stamps')).toBeFocused(); await expect(page.locator('#blechTab-stamps')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#blechPanel-files')).toBeHidden();
  await page.keyboard.press('End'); await expect(page.locator('#blechTab-info')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(page.locator('#blechTab-files')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(page.locator('#blechTab-info')).toBeFocused();
  await page.keyboard.press('Home'); await expect(page.locator('#blechTab-files')).toBeFocused();
  for (const name of tabs) await tab(page, name);
  const after = await page.locator('#blackMidiViewport').boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThan(1); expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  await expect(page.locator('[data-blech-tab][tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('[role="tabpanel"]:visible')).toHaveCount(1);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(0);
});

test('math Drop creates an audible independent layer on the shared falling canvas without arming Audio', async ({ page }) => {
  test.setTimeout(60000); await open(page); await tab(page, 'math');
  await page.locator('#blechMathDrop').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '1');
  const [first] = await samples(page); expect(first).toMatchObject({ loop: true, notes: 256, duration: 8 });
  await expect.poll(() => sources(page)).toContain(`sample:${first.id}`);
  await expect.poll(() => stage(page).evaluate(node => Number(node.dataset.liveNotes))).toBeGreaterThan(0);
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(1);
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#blechMathPreset').selectOption('heart');
  expect((await samples(page))[0]).toMatchObject({ id: first.id, notes: first.notes, duration: first.duration });
  await arm(page); await audible(page);
  await tab(page, 'stamps'); await expect(page.locator('#mixerSavedPads [data-pad-loop]')).toBeChecked();
  await tab(page, 'text'); await audible(page);
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(1);
  await page.locator('#blechLiveLayers button').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect.poll(() => sources(page)).toEqual([]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});

test('two captured drawings become a loopable frame layer while later preparation remains independent', async ({ page }) => {
  await open(page); await tab(page, 'drawing');
  await page.getByRole('button', { name: 'Heart stamp', exact: true }).click();
  await page.locator('#captureDrawingFrame').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', 'drawing');
  await page.getByRole('button', { name: 'Star stamp', exact: true }).click();
  await tab(page, 'frames'); await page.locator('#blechFramesCapture').click();
  await expect(page.locator('.blech-frame-choice')).toHaveCount(2);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  const noteCount = await page.locator('#blechFramesPreview').evaluate(node => Number(node.dataset.notes));
  expect(noteCount).toBeGreaterThan(0);
  await page.locator('#blechFramesDrop').click();
  const [first] = await samples(page); expect(first).toMatchObject({ loop: true, notes: noteCount, duration: 2 });
  await expect.poll(() => sources(page)).toContain(`sample:${first.id}`);
  const originalNotes = await page.evaluate(() => __workspaceQA.engine.state.samples[0].analysis.notes.map(n => [n.note, n.beat, n.duration]));
  await page.locator('#blechFramesDelete').click(); await tab(page, 'drawing'); await page.locator('#drawingClear').click();
  expect(await page.evaluate(() => __workspaceQA.engine.state.samples[0].analysis.notes.map(n => [n.note, n.beat, n.duration]))).toEqual(originalNotes);
  await tab(page, 'frames'); await expect(page.locator('.blech-frame-choice')).toHaveCount(1);
  await page.locator('#blechFramesEdit').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', 'drawing');
  await expect.poll(() => page.locator('#drawingCanvas').evaluate(node => Number(node.dataset.pixels))).toBeGreaterThan(0);
  expect(await page.evaluate(() => __workspaceQA.engine.state.samples[0].analysis.notes.map(n => [n.note, n.beat, n.duration]))).toEqual(originalNotes);
  await expect.poll(() => sources(page)).toContain(`sample:${first.id}`);
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(0);
});

test('file and looped pad playback survive all preparation tabs and pause independently', async ({ page }) => {
  test.setTimeout(90000); await open(page);
  await page.locator('#blackSongSelect').selectOption('depeche-mode-everything-counts');
  await arm(page); await expect(page.locator('#blackPlayButton')).toBeEnabled();
  await page.locator('#blackPlayButton').click(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await tab(page, 'math'); await page.locator('#blechMathDrop').click();
  const [sample] = await samples(page), before = await page.evaluate(() => __workspaceQA.player.state.time);
  for (const name of tabs) {
    await tab(page, name);
    await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
    expect((await samples(page))[0].id).toBe(sample.id);
  }
  await expect.poll(() => page.evaluate(() => __workspaceQA.player.state.time)).toBeGreaterThan(before + .2);
  await expect.poll(() => sources(page)).toContain(`sample:${sample.id}`);
  await audible(page);
  await page.locator('#blackPlayButton').click();
  const paused = await page.evaluate(() => __workspaceQA.player.state.time), padBefore = (await samples(page))[0];
  await tab(page, 'frames'); await page.waitForTimeout(300);
  expect(await page.evaluate(() => __workspaceQA.player.state.time)).toBe(paused);
  const padAfter = (await samples(page))[0];
  expect(padAfter.cycle * padAfter.duration + padAfter.position).toBeGreaterThan(padBefore.cycle * padBefore.duration + padBefore.position);
  await audible(page);
  await page.locator('#blackPlayButton').click(); await page.locator('#blechLiveLayers button').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true'); await audible(page);
  await page.locator('#creativeStop').click(); await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(1);
});

test('editing and dropping an asymmetric saved drawing preserves its falling pitch and time geometry', async ({ page }) => {
  await open(page); await tab(page, 'drawing');
  await input(page, 'mixerStampSpan', 48); await input(page, 'mixerStampBeats', 8);
  const canvas = page.locator('#drawingCanvas'), dimensions = await canvas.evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }));
  // Occupied pitch endpoints retain the exact 48-column grid on reimport.
  // Different top/bottom pitches and two inner points expose a time inversion.
  for (const [column, row] of [[0, 0], [47, 31], [14, 9], [27, 17]]) {
    await canvas.click({ position: { x: (column + .5) / 48 * dimensions.width, y: (row + .5) / 32 * dimensions.height } });
  }
  await page.locator('#mixerSampleLoop').check(); await page.locator('#generateDrawingMidi').click();
  const first = await page.evaluate(() => {
    const sample = __workspaceQA.engine.state.samples[0];
    return { id: sample.id, notes: sample.analysis.notes.map(({ note, beat, duration }) => ({ note, beat, duration })) };
  });
  expect(first.notes).toHaveLength(4);
  expect(first.notes[0].note).toBeGreaterThan(first.notes.at(-1).note);
  await tab(page, 'stamps'); await page.locator('#mixerSavedPads [data-pad-edit]').first().click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', 'drawing');
  await page.locator('#generateDrawingMidi').click();
  const copies = await page.evaluate(() => __workspaceQA.engine.state.samples.map(sample => ({ id: sample.id, notes: sample.analysis.notes.map(({ note, beat, duration }) => ({ note, beat, duration })) })));
  expect(copies).toHaveLength(2); expect(copies[0]).toEqual(first); expect(copies[1].id).not.toBe(first.id); expect(copies[1].notes).toEqual(first.notes);
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(0);
});

test('factory pad loop changes in the persistent live strip survive stopping and retriggering', async ({ page }) => {
  await open(page); await tab(page, 'stamps'); await input(page, 'mixerStampBeats', 16);
  const pad = page.locator('[data-mixer-sample="heart"]'), loop = page.locator('[data-stamp-loop="heart"]');
  await expect(loop).not.toBeChecked(); await pad.click();
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(1);
  const first = (await samples(page))[0]; expect(first.loop).toBe(false);
  await page.locator('#blechLiveLayers input').check(); await expect(loop).toBeChecked();
  expect((await samples(page))[0]).toMatchObject({ id: first.id, loop: true });
  await tab(page, 'math'); await page.locator('#blechLiveLayers button').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await tab(page, 'stamps'); await expect(loop).toBeChecked(); await pad.click();
  const replay = (await samples(page))[0]; expect(replay.loop).toBe(true); expect(replay.id).not.toBe(first.id);
  await page.locator('#blechLiveLayers input').uncheck(); await expect(loop).not.toBeChecked();
  await page.locator('#blechLiveLayers button').click(); await pad.click();
  const oneShot = (await samples(page))[0]; expect(oneShot.loop).toBe(false); expect(oneShot.id).not.toBe(replay.id);
  expect(await page.evaluate(() => __workspaceQA.contexts.length)).toBe(0);
});
