import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';

const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const methodId = 'synthesis-voice-1-method';
const textId = 'synthesis-voice-1-text';

async function readyVoice(page, engine) {
  await expect.poll(async () => (await status(page)).input.voice, { timeout: 40_000 }).toMatchObject({ loading: false, engine });
  await expect(page.locator('#audioError')).toBeHidden();
}
async function sounding(page, engine) {
  await readyVoice(page, engine);
  const measure = await sampleAudioEnvelope(page, { durationMs: 1000 });
  expect(measure.summary.finite).toBe(true);
  expect(measure.summary.maxRms).toBeGreaterThan(.0001);
  expect(measure.summary.maxPeak).toBeLessThanOrEqual(1);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
}

test('voice inputs replace synth panels, retain independent local edits, and never arm Audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html?method=fm&sequence=basic-up');
  const synth = await state(page);
  await choose(page, 'inputCategory', 'speech');
  await expect(page.locator('#voiceDetail')).toBeVisible();
  for (const id of ['synthDetail', 'arpDetail', 'envelopeDetails', 'keyboardDetails', 'processorDetail', 'sourceControls']) await expect(page.locator('#' + id)).toBeHidden();
  await expect(page.locator('#processorEnabled')).toBeEnabled();
  await page.locator('#' + textId).fill('Independent speech settings.');
  const speech = (await state(page)).routing.voice;
  await choose(page, 'inputCategory', 'singing');
  await expect(page.locator('.native-piano-grid')).toBeVisible();
  const singing = (await state(page)).routing.voice;
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  expect((await state(page)).routing.voice.scene).not.toEqual(singing.scene);
  await choose(page, 'inputCategory', 'speech');
  expect((await state(page)).routing.voice).toEqual(speech);
  await choose(page, 'inputCategory', 'synthesis');
  await expect(page.locator('#voiceDetail')).toBeHidden();
  await expect(page.locator('#synthDetail')).toBeVisible();
  expect((await state(page)).methodId).toBe(synth.methodId);
  expect((await status(page)).sequence.id).toBe('basic-up');
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  expect(errors).toEqual([]);
});

test('speech and singing feed one host output, keep playing across Next, and support optional processing', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await choose(page, 'inputCategory', 'speech');
  await readyVoice(page, 'espeak');
  expect((await status(page)).input.voice.playing).toBe(false);
  await page.locator('#playButton').click();
  await sounding(page, 'espeak');
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  await page.waitForTimeout(350);
  await sounding(page, 'espeak');
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await choose(page, 'inputCategory', 'singing');
  await sounding(page, 'singer');
  await page.locator('#processorEnabled').check();
  await choose(page, 'processorMethod', 'fx-delay');
  await page.locator('#nextProcessorPreset').click();
  await sounding(page, 'singer');
  await page.locator('#processorEnabled').uncheck();
  await sounding(page, 'singer');
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  await sounding(page, (await state(page)).routing.voice.scene.engine);
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await choose(page, 'inputCategory', 'signals');
  await choose(page, 'processingSource', 'sine');
  await choose(page, 'inputCategory', 'synthesis');
  const measure = await sampleAudioEnvelope(page, { durationMs: 700 });
  expect(measure.summary.maxRms).toBeGreaterThan(.0001);
  expect(errors).toEqual([]);
});

test('voice preset recall and dice preserve deliberately paused or muted transport', async ({ page }) => {
  test.setTimeout(80_000);
  await page.addInitScript(() => { let seed = 490; Math.random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296; });
  await page.goto('/synthesis.html');
  await choose(page, 'inputCategory', 'speech');
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  await page.getByRole('button', { name: 'Randomize current voice parameters', exact: true }).click();
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await readyVoice(page, (await state(page)).routing.voice.scene.engine);
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  await readyVoice(page, (await state(page)).routing.voice.scene.engine);
  expect(await status(page)).toMatchObject({ armed: true, playing: false });
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await choose(page, 'inputCategory', 'singing');
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  expect(await status(page)).toMatchObject({ armed: false, playing: true });
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
});

test('native knobs change rendered speech and editable singing notes survive state recall', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await choose(page, 'inputCategory', 'speech');
  await page.locator('#audioButton').click();
  await readyVoice(page, 'espeak');
  await page.locator('#playButton').click();
  const before = (await status(page)).input.voice.duration;
  const rate = page.locator('#synthesis-voice-1-global-rate');
  await rate.focus(); await rate.press('End');
  await expect.poll(async () => (await status(page)).input.voice.duration, { timeout: 20_000 }).toBeLessThan(before * .8);
  await sounding(page, 'espeak');
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  await expect(page.locator('[data-select-id="synthesis-voice-1-preset"]')).not.toHaveAttribute('open', '');
  await choose(page, 'inputCategory', 'singing');
  await readyVoice(page, 'singer');
  const original = (await state(page)).routing.voice.scene.input.phrase.notes[0].values.pitch;
  const handle = page.locator('[data-note-handle="0"]');
  await handle.focus(); await handle.press('ArrowUp');
  expect((await state(page)).routing.voice.scene.input.phrase.notes[0].values.pitch).toBeGreaterThan(original);
  await page.keyboard.press('Escape');
  const edited = await state(page);
  await choose(page, 'inputCategory', 'speech');
  await page.evaluate(value => window.MorphazoidSynthesis.applyState(value), edited);
  expect((await state(page)).routing.voice).toEqual(edited.routing.voice);
  await sounding(page, 'singer');
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await page.locator('#playButton').click();
  await page.waitForTimeout(150);
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeLessThan(.00001);
  expect(errors).toEqual([]);
});

test('local voice preset cursors and unapplied lyric drafts survive source switching', async ({ page }) => {
  await page.goto('/synthesis.html');
  await choose(page, 'inputCategory', 'speech');
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  const presetLabel = page.locator('[data-select-id="synthesis-voice-1-preset"] .instrument-picker-current');
  const speechLabel = await presetLabel.textContent();
  await choose(page, 'inputCategory', 'singing');
  await page.locator('#' + textId).fill('Keep this unfinished lyric');
  await choose(page, 'inputCategory', 'speech');
  await expect(presetLabel).toHaveText(speechLabel);
  await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
  await expect(presetLabel).not.toHaveText(speechLabel);
  await choose(page, 'inputCategory', 'singing');
  await expect(page.locator('#' + textId)).toHaveValue('Keep this unfinished lyric');
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
});

test('random voice starting points render across native engines without long gaps or numerical failures', async ({ page }) => {
  test.setTimeout(140_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed).toBe(true);
  await page.locator('#playButton').click();
  for (const engine of ['espeak', 'espeak-klatt', 'hts', 'csound-fof', 'singer', 'stk-voicform', 'sinsy']) {
    const input = ['csound-fof', 'singer', 'stk-voicform', 'sinsy'].includes(engine) ? 'singing' : 'speech';
    await choose(page, 'inputCategory', input);
    for (const seed of [17943, 38421]) {
      await page.evaluate(async ({ engine, input, seed }) => {
        const { voicePresetsForInput, randomizeVoiceMethodState } = await import('/src/instruments/synthesis/voice-input-state.js');
        const preset = voicePresetsForInput(input).find(item => item.state.scene.engine === engine);
        let counter = seed;
        const random = () => (counter = Math.imul(counter, 1664525) + 1013904223 >>> 0) / 4294967296;
        const current = window.MorphazoidSynthesis.getState();
        window.MorphazoidSynthesis.applyState({ ...current, routing: { ...current.routing,
          effectEnabled: false, loop: true, voice: randomizeVoiceMethodState(preset.state, input, random) } });
      }, { engine, input, seed });
      await sounding(page, engine);
      expect(await status(page)).toMatchObject({ armed: true, playing: true });
    }
  }
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`voice panels stay usable without page overflow at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html');
    for (const input of ['speech', 'singing']) {
      await choose(page, 'inputCategory', input);
      await expect(page.locator('#voiceDetail')).toBeVisible();
      await expect(page.locator(`[data-select-id="${methodId}"] summary`)).toBeVisible();
      const methodBox = await page.locator(`[data-select-id="${methodId}"] summary`).boundingBox();
      const presetBox = await page.locator('[data-select-id="synthesis-voice-1-preset"] summary').boundingBox();
      if (Math.abs(methodBox.x - presetBox.x) > 1) {
        expect(Math.abs(methodBox.y - presetBox.y)).toBeLessThan(1);
        expect(Math.abs(methodBox.height - presetBox.height)).toBeLessThan(1);
      }
      const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
      const editor = page.locator('#' + textId);
      await expect(editor).toHaveJSProperty('tagName', 'TEXTAREA');
      await expect(editor).toHaveAttribute('rows', '2');
      const layout = await editor.evaluate(node => {
        const picker = document.querySelector('[data-select-id="synthesis-voice-1-text-preset"]');
        const style = getComputedStyle(node);
        return { height: node.getBoundingClientRect().height, font: parseFloat(style.fontSize),
          background: style.backgroundColor, color: style.color,
          presetAbove: picker.getBoundingClientRect().bottom <= node.closest('.synthesis-voice-field').getBoundingClientRect().top };
      });
      expect(layout).toMatchObject({ background: 'rgb(250, 251, 247)', color: 'rgb(24, 36, 30)', presetAbove: true });
      expect(layout.height).toBe(74);
      expect(layout.font).toBeGreaterThanOrEqual(16);
      await expect(page.locator('.synthesis-voice-history')).toHaveCount(0);
      const info = page.getByRole('button', { name: 'About this voice method', exact: true });
      const popup = page.locator('#synthesis-voice-1-info');
      await expect(popup).not.toBeVisible();
      await info.click();
      await expect(popup).toBeVisible();
      await expect(popup.locator('a').first()).toHaveAttribute('href', /^https:/);
      await page.keyboard.press('Escape');
      await expect(popup).not.toBeVisible();
    }
    const ids = await page.evaluate(() => [...document.querySelectorAll('[id]')].map(node => node.id));
    expect(new Set(ids).size).toBe(ids.length);
    await page.locator('#' + textId).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('voice-editor.png') });
  });
}

test('multiline lyrics remain editable and apply with the button or keyboard shortcut', async ({ page }) => {
  await page.goto('/synthesis.html');
  await choose(page, 'inputCategory', 'singing');
  await choose(page, methodId, 'stk-voicform');
  const editor = page.locator('#' + textId);
  const before = (await state(page)).routing.voice.scene;
  await editor.fill('ah');
  await editor.press('End'); await editor.press('Enter'); await editor.press('o');
  await expect(editor).toHaveValue('ah\no');
  expect((await state(page)).routing.voice.scene).toEqual(before);
  await page.getByRole('button', { name: 'Apply lyrics to notes', exact: true }).click();
  await expect.poll(async () => (await state(page)).routing.voice.scene.input.singingText).toBe('ah\no');
  await editor.fill('oo\nee'); await editor.press('Control+Enter');
  await expect.poll(async () => (await state(page)).routing.voice.scene.input.singingText).toBe('oo\nee');
  await choose(page, 'synthesis-voice-1-text-preset', 'vowel-orbit');
  await expect.poll(async () => (await state(page)).routing.voice.scene.input.singingText).toBe('so o o o oh oh oh ohoh');
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
});

test.describe('touch voice editing', () => {
  test.use({ hasTouch: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`lyrics and method info are reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/synthesis.html');
      await choose(page, 'inputCategory', 'singing');
      await choose(page, methodId, 'stk-voicform');
      const editor = page.locator('#' + textId);
      await editor.tap(); await editor.fill('ah\noh');
      await page.getByRole('button', { name: 'Apply lyrics to notes', exact: true }).tap();
      await expect.poll(async () => (await state(page)).routing.voice.scene.input.singingText).toBe('ah\noh');
      await page.getByRole('button', { name: 'About this voice method', exact: true }).tap();
      const popup = page.locator('#synthesis-voice-1-info');
      await expect(popup).toBeVisible();
      await expect(popup.locator('h2')).toHaveText('STK VoicForm');
      // A tap outside the popup dismisses it; no permanent About block remains.
      await page.touchscreen.tap(2, 2);
      await expect(popup).not.toBeVisible();
      await editor.tap();
      await expect(editor).toBeFocused();
      expect(await status(page)).toMatchObject({ armed: false, playing: false });
    });
  }
});
