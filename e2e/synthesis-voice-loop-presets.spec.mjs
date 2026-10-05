import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';

const prefix = 'synthesis-voice-1';
const ids = { method: `${prefix}-method`, text: `${prefix}-text`, textPreset: `${prefix}-text-preset`, kind: `${prefix}-text-kind`, melody: `${prefix}-melody-preset` };
const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const voice = async page => (await state(page)).routing.voice;
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
const action = (page, name) => page.getByRole('button', { name, exact: true });
const notes = scene => scene.engine === 'sinsy' ? scene.input.notes : scene.input.phrase.notes;

// A lyric occupies one melodic slot even when its consonants and vowel are
// represented by several native notes. Compare its audible pitch and total time.
function melodySlots(scene) {
  const score = scene.engine === 'sinsy', tempo = score ? scene.input.tempo : scene.input.phrase.tempo;
  const slots = [];
  for (const note of notes(scene)) {
    const slot = note.textSlot ?? note.textSyllable;
    const pitch = score ? note.midi : note.values.pitch;
    const rest = Boolean(note.rest || score && note.midi === null);
    const beats = score ? note.beats : note.values.duration * tempo / 60;
    const previous = slots.at(-1);
    if (!score && !rest && previous && !previous.rest && slot !== undefined && previous.slot === slot && previous.pitch === pitch) previous.beats += beats;
    else slots.push({ slot, pitch, rest, beats });
  }
  return slots.map(({ pitch, rest, beats }) => ({ pitch, rest, beats }));
}

function expectSameMelody(before, after) {
  expect(after).toHaveLength(before.length);
  before.forEach((slot, index) => {
    expect(after[index].pitch).toBe(slot.pitch);
    expect(after[index].rest).toBe(slot.rest);
    expect(after[index].beats).toBeCloseTo(slot.beats, 9);
  });
}

function withoutAxis(value, axis) {
  const next = structuredClone(value), score = next.scene.engine === 'sinsy';
  for (const note of notes(next.scene)) {
    if (score) delete note[axis === 'pitch' ? 'midi' : 'beats'];
    else delete note.values[axis === 'pitch' ? 'pitch' : 'duration'];
  }
  return next;
}

async function startSinging(page, engine = 'singer') {
  await page.goto('/synthesis.html');
  await choose(page, 'inputCategory', 'singing');
  if (engine !== 'singer') await choose(page, ids.method, engine);
  await expect(page.locator('.native-piano-grid')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let seed = 581;
    Math.random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
  });
});

test('loop text, pitch and length controls edit independent musical axes', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await startSinging(page);
  await choose(page, ids.melody, 'easy-rise');
  const melody = melodySlots((await voice(page)).scene);
  for (const preset of ['night-song', 'mouth-drums', 'open-vowels']) {
    await choose(page, ids.textPreset, preset);
    const next = await voice(page);
    expectSameMelody(melody, melodySlots(next.scene));
    await expect(page.locator('#' + ids.text)).toHaveValue(next.text);
    expect(next.scene.input.singingText).toBe(next.text);
  }
  await choose(page, ids.kind, 'percussion');
  const beforeText = await voice(page);
  await action(page, 'Randomize loop text').click();
  const afterText = await voice(page);
  expect(afterText.text).not.toBe(beforeText.text);
  expectSameMelody(melody, melodySlots(afterText.scene));

  await action(page, 'Randomize pitches').click();
  const afterPitch = await voice(page);
  expect(withoutAxis(afterPitch, 'pitch')).toEqual(withoutAxis(afterText, 'pitch'));
  expect(notes(afterPitch.scene).map(note => note.values.pitch)).not.toEqual(notes(afterText.scene).map(note => note.values.pitch));
  await action(page, 'Randomize note lengths').click();
  const afterLength = await voice(page);
  expect(withoutAxis(afterLength, 'length')).toEqual(withoutAxis(afterPitch, 'length'));
  const loop = melodySlots(afterLength.scene);
  expect([8, 16]).toContain(Math.round(loop.reduce((sum, note) => sum + note.beats, 0)));
  expect(loop.every(note => note.beats > 0)).toBe(true);
  await expect(page.locator('#audioError')).toBeHidden();
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  expect(errors).toEqual([]);
});

test('pitch and length changes retain unapplied lyrics, selected note and recalled state', async ({ page }) => {
  await startSinging(page);
  await choose(page, ids.textPreset, 'open-vowels');
  const selected = page.locator('[data-note-handle="2"]');
  await selected.click();
  await page.keyboard.press('Escape');
  await page.locator('#' + ids.text).fill('Keep these unfinished words');
  await expect(page.locator('#' + ids.textPreset)).toHaveValue('');
  const appliedText = (await voice(page)).text;
  for (const name of ['Randomize pitches', 'Randomize note lengths']) {
    await action(page, name).click();
    await expect(page.locator('#' + ids.text)).toHaveValue('Keep these unfinished words');
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect((await voice(page)).text).toBe(appliedText);
  }
  const edited = await state(page);
  await choose(page, 'inputCategory', 'speech');
  await choose(page, 'inputCategory', 'singing');
  await expect(page.locator('#' + ids.text)).toHaveValue('Keep these unfinished words');
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect((await state(page)).routing.voice).toEqual(edited.routing.voice);
  await choose(page, ids.melody, 'minor-answer');
  await page.evaluate(value => window.MorphazoidSynthesis.applyState(value), edited);
  expect((await state(page)).routing.voice).toEqual(edited.routing.voice);
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
});

test('all singing engines expose compatible loop text and editable pitch patterns', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await startSinging(page);
  for (const engine of ['singer', 'stk-voicform', 'csound-fof', 'csound-vosim', 'sinsy']) {
    if ((await voice(page)).scene.engine !== engine) await choose(page, ids.method, engine);
    const categories = await page.locator('#' + ids.kind).evaluate(node => [...node.options].map(option => option.value));
    expect(categories).toContain('words'); expect(categories).toContain('vowels');
    expect(categories.includes('percussion')).toBe(!engine.startsWith('csound-'));
    const textOptions = await page.locator('#' + ids.textPreset).evaluate(node => [...node.options].map(option => option.value));
    expect(textOptions.includes('mouth-drums')).toBe(!engine.startsWith('csound-'));
    await choose(page, ids.textPreset, 'open-vowels');
    await choose(page, ids.melody, 'small-steps');
    await choose(page, ids.kind, 'vowels');
    await action(page, 'Randomize loop text').click();
    const before = await voice(page);
    await action(page, 'Randomize pitches').click();
    const pitched = await voice(page);
    expect(withoutAxis(pitched, 'pitch')).toEqual(withoutAxis(before, 'pitch'));
    await action(page, 'Randomize note lengths').click();
    const sized = await voice(page);
    expect(withoutAxis(sized, 'length')).toEqual(withoutAxis(pitched, 'length'));
    expect(melodySlots(sized.scene).every(note => note.beats > 0 && (note.rest || Number.isFinite(note.pitch)))).toBe(true);
    if (engine === 'sinsy') expect(sized.text).toMatch(/[ぁ-ん]/);
    await expect(page.locator('#audioError')).toBeHidden();
    expect(await status(page)).toMatchObject({ armed: false, playing: false });
  }
  expect(errors).toEqual([]);
});

test('loop edits retain muted, paused and running Audio and transport state', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await startSinging(page, 'stk-voicform');
  await choose(page, ids.textPreset, 'open-vowels');
  await choose(page, ids.melody, 'held-answer');
  await page.locator('#playButton').click();
  await action(page, 'Randomize pitches').click();
  expect(await status(page)).toMatchObject({ armed: false, playing: true });
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await expect.poll(() => status(page)).toMatchObject({ armed: true, playing: false });
  await action(page, 'Randomize note lengths').click();
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeLessThan(.00001);
  await page.locator('#playButton').click();
  for (const name of ['Randomize pitches', 'Randomize note lengths', 'Randomize loop text']) {
    await action(page, name).click();
    await expect.poll(() => status(page), { timeout: 30_000 }).toMatchObject({ armed: true, playing: true, input: { voice: { loading: false, playing: true, engine: 'stk-voicform', timingsCurrent: true, renderError: null } } });
    const measured = await sampleAudioEnvelope(page, { durationMs: 650 });
    expect(measured.summary.finite).toBe(true);
    expect(measured.summary.maxRms).toBeGreaterThan(.0001);
    expect(measured.summary.maxPeak).toBeLessThanOrEqual(1);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
    await expect(page.locator('#audioError')).toBeHidden();
  }
  expect((await state(page)).routing.loop).toBe(true);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`loop controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await startSinging(page);
    await choose(page, ids.melody, 'low-bounce');
    await choose(page, ids.textPreset, 'mouth-drums');
    for (const id of [ids.textPreset, ids.kind, ids.melody]) {
      const control = page.locator(`[data-select-id="${id}"] summary`);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    for (const name of ['Randomize loop text', 'Randomize pitches', 'Randomize note lengths']) {
      const control = action(page, name);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      await control.click();
    }
    const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    await page.locator(`[data-select-id="${ids.melody}"]`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('voice-loop-controls.png') });
    expect(await status(page)).toMatchObject({ armed: false, playing: false });
  });
}
