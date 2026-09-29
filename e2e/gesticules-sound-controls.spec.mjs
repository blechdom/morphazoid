import {test, expect} from '@playwright/test';
import {readAudioStatus} from './helpers/audio-probe.mjs';

const FIELDS = [
  ['pitch', -2, 2, 1.25], ['tone', -1, 1, .43], ['grain', -1, 1, -.38],
  ['pan', -1, 1, -.7], ['attackScale', .25, 4, 2.25], ['releaseScale', .25, 4, .55],
];
const GLOBAL_IDS = ['rhythm', 'note-length', 'rootHz', 'pitchSpread', 'brightness', 'roughness', 'rotationFx', 'space', 'attack', 'release'];
const snapshot = page => page.evaluate(() => window.__gesticulatingHand.snapshot());
const range = (page, id, value) => page.locator('#' + id).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));
}, value);
const selectVoice = (page, index) => page.locator(`#voiceTabs [data-finger="${index}"]`).click();
const chooseScene = async (page, label) => {
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button', {name: label, exact: true}).click();
  await page.waitForFunction(() => window.__gesticulatingHand.snapshot().loaded);
};
async function expectVoiceSync(page, index) {
  const state = await snapshot(page), voice = state.config.voices[index];
  const name = await page.locator(`#voiceTabs [data-finger="${index}"]`).textContent();
  expect(state.selected).toBe(index);
  await expect(page.locator('#voiceSoundTitle')).toHaveText(`${name} sound`);
  await expect(page.locator(`#voiceTabs [data-finger="${index}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#voiceTabs [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('#voiceSource')).toHaveValue(voice.source);
  await expect(page.locator(`#source-${index}`)).toHaveValue(voice.source);
  for (const [key, low, high] of FIELDS) {
    const input = page.locator(`#voice-${key}`);
    expect(Number(await input.inputValue())).toBeCloseTo(voice[key], 8);
    const needle = await input.locator('..').locator('.mz-range-knob__dial i').getAttribute('style');
    expect(Number(needle.match(/rotate\(([-\d.]+)deg\)/)[1])).toBeCloseTo(-135 + (voice[key] - low) / (high - low) * 270, 8);
    await expect(page.locator(`#voice-${key}Out`)).not.toBeEmpty();
  }
}

test.beforeEach(async ({page}) => {
  page.soundControlErrors = [];
  page.on('pageerror', error => page.soundControlErrors.push(error.message));
  await page.goto('gesticules.html');
  await page.waitForFunction(() => window.__gesticulatingHand?.snapshot().loaded);
});
test.afterEach(async ({page}) => expect(page.soundControlErrors).toEqual([]));

test('selected voice and shared sound controls are open directly after Play', async ({page}) => {
  await expect(page.locator('#voiceSound')).toBeVisible();
  await expect(page.locator('#voiceTabs [data-finger]')).toHaveCount(5);
  expect(await page.locator('#voiceSource option').evaluateAll(nodes => nodes.map(node => node.value)))
    .toEqual(await page.locator('#source-0 option').evaluateAll(nodes => nodes.map(node => node.value)));
  for (const [key, low, high] of FIELDS) {
    const input = page.locator(`#voice-${key}`);
    await expect(input).toHaveAttribute('type', 'range');
    await expect(input).toHaveAttribute('min', String(low));
    await expect(input).toHaveAttribute('max', String(high));
    await expect(input.locator('..')).toHaveClass(/mz-range-knob/);
    await expect(input).toHaveAccessibleName(/\S/);
  }
  const layout = await page.evaluate(ids => {
    const sections = ['playTitle', 'voiceSoundTitle', 'soundTitle', 'movementTitle'].map(id => document.getElementById(id).closest('section'));
    return {ordered: sections.every((section, index) => !index || Boolean(sections[index - 1].compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)),
      closed: sections.some(section => section.closest('details:not([open]), [hidden]')),
      globalIds: [...document.querySelectorAll('.hand-sound-grid input, .hand-sound-grid select')].map(node => node.id),
      columns: getComputedStyle(document.querySelector('.hand-sound-grid')).gridTemplateColumns.split(/\s+/).length,
      allOwned: ids.every(id => document.getElementById(id).closest('section') === sections[2])};
  }, GLOBAL_IDS);
  expect(layout).toEqual({ordered: true, closed: false, globalIds: GLOBAL_IDS, columns: 2, allOwned: true});
  await expectVoiceSync(page, (await snapshot(page)).selected);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

test('row names, joint menus and engine focus select the same sound bank in both forms', async ({page}) => {
  for (const form of ['hand', 'foot']) {
    await page.locator('#bodyForm').selectOption(form);
    await page.waitForFunction(form => window.__gesticulatingHand.snapshot().loaded && window.__gesticulatingHand.snapshot().viewer.form === form, form);
    await page.locator('#fingerMixer [data-finger="3"]').click();await expectVoiceSync(page, 3);
    await page.locator('#contour-joint-1').selectOption('pip');await expectVoiceSync(page, 1);
    await page.locator('#source-4').focus();await expectVoiceSync(page, 4);
    const before = await snapshot(page);
    await page.locator('#voiceSource').selectOption('choir');await expectVoiceSync(page, 4);
    let state = await snapshot(page);
    expect(state.config.voices[4].source).toBe('choir');
    expect(state.config.voices.slice(0, 4)).toEqual(before.config.voices.slice(0, 4));
    await page.locator('#source-2').selectOption('marimba');await expectVoiceSync(page, 2);
    await selectVoice(page, 0);await expectVoiceSync(page, 0);
    state = await snapshot(page);
    expect(state.audioOn).toBe(false);expect(state.audio.contextState).toBe('uninitialized');
  }
});

test('six native knobs edit only the selected voice and retain pointer and keyboard behavior', async ({page}) => {
  await selectVoice(page, 2);const before = await snapshot(page);
  const expected = {...before.config.voices[2]};
  for (const [key, , , value] of FIELDS) {
    await range(page, `voice-${key}`, value);expected[key] = value;
    const after = await snapshot(page);
    expect(after.config.voices[2]).toEqual(expected);
    for (const index of [0, 1, 3, 4]) expect(after.config.voices[index]).toEqual(before.config.voices[index]);
    expect(after.config.sound).toEqual(before.config.sound);expect(after.config.motion).toEqual(before.config.motion);
  }
  await selectVoice(page, 4);await range(page, 'voice-tone', -.64);await selectVoice(page, 2);await expectVoiceSync(page, 2);
  const input = page.locator('#voice-pitch');await range(page, 'voice-pitch', 0);
  await input.scrollIntoViewIfNeeded();const rect = await input.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);await page.mouse.down();
  await expect(input).toHaveValue('0');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 - 15, {steps: 3});
  await expect(input).toHaveValue('0.5');
  const pointerId = await input.evaluate(node => [1, 2, 3].find(id => node.hasPointerCapture(id)));
  expect(pointerId).toBeDefined();await input.dispatchEvent('pointercancel', {pointerId});
  await page.mouse.move(rect.x + rect.width / 2, rect.y - 30);await page.mouse.up();
  await expect(input).toHaveValue('0.5');
  await input.focus();await input.press('Home');await expect(input).toHaveValue('-2');
  await input.press('End');await expect(input).toHaveValue('2');
  await input.press('ArrowLeft');await expect(input).toHaveValue('1.99');
  await expectVoiceSync(page, 2);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

test('voice settings survive form changes and full presets restore the bank without stopping players', async ({page}) => {
  await range(page, 'outputLevel', .23);await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  await selectVoice(page, 3);
  for (const [key, , , value] of FIELDS) await range(page, `voice-${key}`, value);
  const edited = await snapshot(page);
  for (const form of ['foot', 'hand']) {
    await page.locator('#bodyForm').selectOption(form);
    await page.waitForFunction(form => window.__gesticulatingHand.snapshot().loaded && window.__gesticulatingHand.snapshot().viewer.form === form, form);
    expect((await snapshot(page)).config.voices).toEqual(edited.config.voices);await expectVoiceSync(page, 3);
  }
  for (const label of ['Lingering choir', 'Marimba footprints']) {
    await chooseScene(page, label);await selectVoice(page, 2);const saved = await snapshot(page);
    for (const [key, low, high] of FIELDS) await range(page, `voice-${key}`, saved.config.voices[2][key] === high ? low : high);
    await page.locator('#voiceSource').selectOption(saved.config.voices[2].source === 'air' ? 'metal' : 'air');
    await chooseScene(page, label);const restored = await snapshot(page);
    expect(restored.config).toEqual(saved.config);await expectVoiceSync(page, 2);
    expect(restored.playing).toBe(true);expect(restored.soundPlaying).toBe(true);expect(restored.audioOn).toBe(false);
    expect(restored.audio.contextState).toBe('uninitialized');await expect(page.locator('#outputLevel')).toHaveValue('0.23');
  }
});

test('per-voice pan reaches the real stereo worklet while edits preserve explicit Audio and playback', async ({page}) => {
  await page.locator('#motionPreset').selectOption('still');await page.locator('#rhythm').selectOption('continuous');
  await range(page, 'space', 0);await range(page, 'rotationFx', 0);
  await selectVoice(page, 2);await page.locator('#voiceSource').selectOption('pulse');await page.locator('#solo-2').click();
  await range(page, 'voice-level-2', .7);await range(page, 'voice-pan', -1);
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  await expect.poll(async () => {const s = await readAudioStatus(page);return s.leftPeak > .001 && s.leftPeak > s.rightPeak * 2;}).toBe(true);
  const before = await snapshot(page), connectionCount = (await readAudioStatus(page)).connectionCount;
  await range(page, 'voice-pan', 1);
  await expect.poll(async () => {const s = await readAudioStatus(page);return s.rightPeak > .001 && s.rightPeak > s.leftPeak * 2;}).toBe(true);
  for (const [key, , , value] of FIELDS.filter(([key]) => key !== 'pan')) await range(page, `voice-${key}`, value);
  const running = await snapshot(page), output = await readAudioStatus(page);
  expect(running.audioOn && running.playing && running.soundPlaying).toBe(true);
  expect(running.time).toBeGreaterThan(before.time);expect(running.audio.contextState).toBe('running');
  expect(Number.isFinite(output.peak)).toBe(true);expect(output.peak).toBeLessThanOrEqual(.890001);
  expect(output.connectionCount).toBe(connectionCount);
  await page.locator('#audioButton').click();await expect.poll(async () => (await snapshot(page)).audio.rms).toBeLessThan(.001);
  const muted = await snapshot(page);expect(muted.audioOn).toBe(false);expect(muted.playing && muted.soundPlaying).toBe(true);
});

for (const viewport of [{width: 390, height: 844}, {width: 844, height: 390}, {width: 320, height: 568}]) {
  test.describe(`coarse pointer ${viewport.width}×${viewport.height}`, () => {
  test.use({viewport, hasTouch: true, isMobile: true});
  test(`sound controls stay reachable below the pinned stage at ${viewport.width}×${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    for (const form of ['hand', 'foot']) {
      await page.locator('#bodyForm').selectOption(form);
      await page.waitForFunction(form => window.__gesticulatingHand.snapshot().loaded && window.__gesticulatingHand.snapshot().viewer.form === form, form);
      await page.evaluate(() => scrollTo(0, 0));
      const stageTop = await page.locator('#handStage').evaluate(node => node.getBoundingClientRect().top);
      const order = await page.evaluate(() => {
        const nodes = ['#handStage', '.instrument-preset-controls', '.hand-transports', '.hand-voices', '#voiceSound']
          .map(selector => document.querySelector(selector));
        const bounds = nodes.map(node => node.getBoundingClientRect());
        return {
          visual: bounds.every((box, i) => !i || box.top >= bounds[i - 1].bottom - 1),
          reading: nodes.every((node, i) => !i || Boolean(nodes[i - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)),
          presetGap: bounds[1].top - bounds[0].bottom,
          presetBottom: bounds[1].bottom,
        };
      });
      expect(order.visual).toBe(true);expect(order.reading).toBe(true);
      expect(order.presetGap).toBeLessThanOrEqual(2);expect(order.presetBottom).toBeLessThan(viewport.height);
      await page.locator('#fingerMixer [data-finger="4"]').click();await expectVoiceSync(page, 4);
      const revealed = await page.locator('#voiceSoundTitle').evaluate(node => ({title: node.getBoundingClientRect().toJSON(), stageBottom: document.getElementById('handStage').getBoundingClientRect().bottom, height: innerHeight}));
      expect(revealed.title.top).toBeGreaterThanOrEqual(revealed.stageBottom - 1);expect(revealed.title.bottom).toBeLessThanOrEqual(revealed.height);
      await page.locator('#voiceSource').scrollIntoViewIfNeeded();await expect(page.locator('#voiceSource')).toBeVisible();
      for (const id of ['voice-pitch', 'voice-releaseScale', 'rhythm', 'release', 'motionPreset']) {
        await page.locator('#' + id).scrollIntoViewIfNeeded();
        const position = await page.locator('#' + id).evaluate(node => {
          const r = node.getBoundingClientRect(), stage = document.getElementById('handStage').getBoundingClientRect();
          return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, stageTop: stage.top, stageBottom: stage.bottom,
            width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth};
        });
        expect(position.scrollWidth).toBeLessThanOrEqual(position.width);
        expect(position.left).toBeGreaterThanOrEqual(0);expect(position.right).toBeLessThanOrEqual(position.width);
        expect(position.top).toBeGreaterThanOrEqual(position.stageBottom - 1);expect(position.bottom).toBeLessThanOrEqual(position.height);
        expect(position.stageTop).toBeCloseTo(stageTop, 0);
        if (id.startsWith('voice-')) {expect(position.right - position.left).toBeGreaterThanOrEqual(48);expect(position.bottom - position.top).toBeGreaterThanOrEqual(48);}
      }
      expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    }
  });
  });
}
