import { test, expect } from '@playwright/test';

const generators = ['files', 'frames', 'math', 'text', 'automata'];
const frameTools = ['stamps', 'drawing', 'art', 'scripts', 'sequence'];
const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__dropQA = { engine: null, contexts: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __dropQA.contexts.push(this); } };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst observeDropVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){__dropQA.engine=this;return observeDropVolume.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechDropSend')).toBeAttached();
  await expect.poll(() => page.locator('#blackSongSelect option').count()).toBeGreaterThan(100);
  await expect.poll(async () => (await page.locator('#blackMidiViewport').boundingBox())?.height ?? 0).toBeGreaterThan(100);
}

async function tab(page, name) {
  await page.locator(`#blechTab-${name}`).click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-tab', name);
}
async function frameTab(page, name) {
  await page.locator(`#blechTab-${name}`).click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-frame', name);
}
async function change(page, id, value, type = 'input') {
  await page.locator(`#${id}`).evaluate((node, { value, type }) => {
    node.value = String(value); node.dispatchEvent(new Event(type, { bubbles: true }));
  }, { value, type });
}
const samples = page => page.evaluate(() => __dropQA.engine.state.samples.map(sample => ({
  id: sample.id, source: sample.source, channel: sample.channel, transpose: sample.transpose, delayBeats: sample.delayBeats,
  loop: sample.loop, paused: sample.paused, gain: sample.gain, program: sample.midi.program,
  position: sample.positionBeats, cycle: sample.cycle, pending: sample.pending,
  notes: sample.analysis.noteCount, channels: [...new Set(sample.analysis.notes.map(note => note.channel))],
  pitches: sample.analysis.notes.map(note => note.note),
})));
async function silentPreparation(page) {
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __dropQA.contexts.length)).toBe(0);
}

for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`five generators stay separate from output controls and fit ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await open(page);
    const mobile = name !== 'desktop';
    const graphic = page.locator('#blackMidiViewport'), controls = page.locator('.blech-workbench');
    const graphicBox = await graphic.boundingBox();
    if (mobile) {
      const controlsBox = await controls.boundingBox();
      expect((await page.locator('#creativeStage').boundingBox()).height).toBeCloseTo(controlsBox.height, 0);
      expect(controlsBox.y).toBeGreaterThanOrEqual(graphicBox.y + graphicBox.height);
      await expect(graphic).toBeInViewport({ ratio: 1 });
    }
    const prepared = await page.locator('.blech-drop-handle').boundingBox();
    const previewActions = await page.locator('.blech-drop-floating').boundingBox();
    expect(previewActions.y).toBeGreaterThanOrEqual(prepared.y + prepared.height);
    expect(previewActions.y + previewActions.height).toBeLessThanOrEqual(graphicBox.y + graphicBox.height);
    const generatorList = page.getByRole('tablist', { name: 'Generators', exact: true });
    await expect(generatorList.getByRole('tab')).toHaveText(['Math', 'Files', 'Frames', 'Text', 'Automata']);
    await expect(page.getByRole('tablist', { name: 'Output settings' }).getByRole('tab')).toHaveText(['FX', 'Visualizer']);
    await expect(page.locator('#blechPanel-info')).toHaveJSProperty('tagName', 'FOOTER');
    await expect(page.locator('[data-blech-tab="info"]')).toHaveCount(0);
    await expect(page.locator('#creativeVolumeHost')).toBeHidden();
    const keyboard = await page.locator('.blech-playable-keyboard').boundingBox();
    expect(keyboard.width).toBeGreaterThan(100); expect(keyboard.height).toBeGreaterThan(10);
    for (const id of generators) {
      await tab(page, id); await expect(page.locator('#blechDropControls')).toBeVisible();
      if (id === 'frames') {
        for (const tool of frameTools) await frameTab(page, tool);
        await frameTab(page, 'stamps');
        await expect(page.locator('#blechStampPicker .blech-stamp-thumbnail:visible')).toHaveCount(1);
        await expect(page.locator('#creativePadsHost .mixer-stamp-palette')).toBeHidden();
      }
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - innerWidth,
        panels: [...document.querySelectorAll('.blech-preparation, .blech-workbench, #blechDropControls')].filter(node => node.getBoundingClientRect().width).map(node => ({ name: node.id || node.className, overflow: node.scrollWidth - node.clientWidth })),
      }));
      expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
      expect(overflow.panels.filter(panel => panel.overflow > 1), JSON.stringify(overflow)).toEqual([]);
      await page.locator('#blechDropChannel').scrollIntoViewIfNeeded();
      const box = await page.locator('#blechDropChannel').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      if (mobile) {
        expect(box.y).toBeGreaterThanOrEqual((await controls.boundingBox()).y);
        expect(await graphic.boundingBox()).toEqual(graphicBox);
      }
    }
    await silentPreparation(page);
    for (const id of ['sound', 'visuals']) { await tab(page, id); await expect(page.locator('#blechDropControls')).toBeHidden(); }
    await tab(page, 'math'); await expect(page.locator('#blechDropControls')).toBeVisible();
    await page.locator('#blechTab-files').focus(); await page.keyboard.press('End');
    await expect(page.locator('#blechTab-automata')).toBeFocused();
    await page.locator('#blechTab-sound').focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('#blechTab-visuals')).toBeFocused();
    await page.locator('#blechPanel-info summary').first().scrollIntoViewIfNeeded();
    await expect(page.locator('#blechPanel-info summary').first()).toBeInViewport();
    if (mobile) {
      expect(await page.locator('.blech-preparation').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      expect(await graphic.boundingBox()).toEqual(graphicBox);
      expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
      // Existing controls return to the desktop stage after a resize, keeping
      // their values and keyboard focus rather than mounting another instrument.
      await page.locator('#creativeTempoExact').fill('137');
      await page.locator('#creativeTempoExact').press('Tab');
      await page.locator('#blechMasterPlay').focus();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator('#creativeStage #blechMasterPlay')).toBeFocused();
      await expect(page.locator('#creativeTempoExact')).toHaveValue('137');
      await page.setViewportSize({ width, height });
      await expect(page.locator('.blech-preparation #blechMasterPlay')).toBeFocused();
      await expect.poll(() => graphic.boundingBox()).toEqual(graphicBox);
      await silentPreparation(page);
    }
  });
}

test('stamps, drawings and math stage silently; pointer and keyboard place an independently routed drop', async ({ page }) => {
  await open(page); await tab(page, 'frames');
  await expect(page.locator('.blech-drop-overlay')).toBeVisible();
  await page.locator('#blechStampPicker summary').click();
  await page.getByRole('searchbox', { name: 'Filter MIDI stamps' }).fill('plaid');
  await page.getByRole('searchbox', { name: 'Filter MIDI stamps' }).press('Enter');
  await expect(page.locator('#blechDropName')).toContainText(/plaid/i); await silentPreparation(page);
  await frameTab(page, 'drawing'); await page.getByRole('button', { name: 'Heart stamp', exact: true }).click();
  await expect(page.locator('#blechDropName')).toContainText('Your drawing');
  await expect(page.locator('.blech-drop-overlay')).toBeVisible(); await silentPreparation(page);
  await tab(page, 'math');
  await change(page, 'blechMathLow', 36); await change(page, 'blechMathHigh', 84);
  await expect(page.locator('#blechDropName')).toContainText('Custom equation');
  await page.locator('#blechDropChannel').selectOption({ value: '6' }); await page.locator('#blechDropProgram').selectOption({ value: '4' });
  await change(page, 'blechDropGain', .42);
  const handle = page.locator('.blech-drop-handle'); await handle.focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  await expect(page.locator('#blechDropPitch')).toHaveValue('1'); await expect(page.locator('#blechDropDelay')).toHaveValue('2.25');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.max(10, box.height / 2));
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 36, box.y + Math.max(10, box.height / 2) - 15, { steps: 5 }); await page.mouse.up();
  const transpose = Number(await page.locator('#blechDropPitch').inputValue()), delay = Number(await page.locator('#blechDropDelay').inputValue());
  expect(transpose).toBeGreaterThan(1); expect(delay).toBeGreaterThan(2.25); await silentPreparation(page);
  await page.locator('#blechDropOnce').click();
  await page.locator('[data-stage-loop]').click(); await page.locator('[data-stage-send]').click();
  await expect(page.locator('.blech-drop-overlay')).toBeHidden(); await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(1);
  const [sent] = await samples(page);
  expect(sent).toMatchObject({ source: 'math', channel: 6, transpose, delayBeats: delay, loop: true, gain: .42, program: 4, channels: [6] });
  expect(sent.notes).toBeGreaterThan(0); expect(Math.min(...sent.pitches)).toBeGreaterThanOrEqual(36 + transpose);
  expect(Math.max(...sent.pitches)).toBeLessThanOrEqual(84 + transpose);
  const stage = page.locator('.midiphoria-black-stage');
  await expect.poll(() => stage.evaluate(node => JSON.parse(node.dataset.liveSources || '[]'))).toContain(`sample:${sent.id}`);
  await expect.poll(() => stage.evaluate(node => Number(node.dataset.liveNotes || 0))).toBeGreaterThan(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await change(page, 'blechMathLow', 48); await change(page, 'blechMathHigh', 72);
  await expect(page.locator('.blech-drop-overlay')).toBeVisible();
  expect((await samples(page))[0]).toMatchObject({ id: sent.id, pitches: sent.pitches, channels: [6] });
});

test('source Stop leaves other generators running and individual layers pause, resume and change their loop', async ({ page }) => {
  test.setTimeout(60000); await open(page); await tab(page, 'math');
  await page.locator('#blechDropLoop').click(); await change(page, 'blechDropDelay', 0, 'change'); await page.locator('#blechDropSend').click();
  const [math] = await samples(page);
  await change(page, 'blechDropGain', .2);
  expect((await samples(page))[0].gain).toBe(math.gain);
  await tab(page, 'frames'); await frameTab(page, 'drawing');
  await page.getByRole('button', { name: 'Heart stamp', exact: true }).click();
  await page.locator('#blechDropLoop').click(); await change(page, 'blechDropDelay', 0, 'change'); await page.locator('#blechDropSend').click();
  const frame = (await samples(page)).find(sample => sample.source === 'frames');
  expect(frame).toBeTruthy(); await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(2);
  await page.locator(`.blech-live-layer[data-sample-id="${math.id}"] [data-layer-gain]`).evaluate(node => {
    node.value = '.25'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((await samples(page)).find(sample => sample.id === math.id).gain).toBe(.25);
  expect((await samples(page)).find(sample => sample.id === frame.id).gain).toBe(frame.gain);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await expect.poll(async () => (await samples(page)).find(sample => sample.id === frame.id)?.position ?? 0).toBeGreaterThan(.2);
  const row = page.locator(`.blech-live-layer[data-sample-id="${frame.id}"]`);
  await row.locator('[data-layer-pause]').click(); await expect(row).toHaveAttribute('data-paused', 'true');
  const paused = (await samples(page)).find(sample => sample.id === frame.id);
  await expect.poll(async () => (await samples(page)).find(sample => sample.id === math.id)?.position ?? 0).toBeGreaterThan(.5);
  expect((await samples(page)).find(sample => sample.id === frame.id).position).toBeCloseTo(paused.position, 5);
  await tab(page, 'math'); await page.locator('#blechDropStop').click();
  expect((await samples(page)).map(sample => sample.id)).toEqual([frame.id]);
  await row.locator('[data-layer-pause]').click(); await expect(row).toHaveAttribute('data-paused', 'false');
  await expect.poll(async () => (await samples(page)).find(sample => sample.id === frame.id)?.position ?? 0).toBeGreaterThan(paused.position + .1);
  await row.locator('[data-layer-loop]').uncheck();
  expect((await samples(page)).find(sample => sample.id === frame.id).loop).toBe(false);
  await row.locator('[data-layer-stop]').click(); await expect(row).toHaveCount(0);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});
