import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {HAND_PRESETS} from '../src/instruments/gesticulating-hand/hand-model.js';
import {sampleAudioEnvelope} from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(() => window.__gesticulatingHand.snapshot());
const scope = async (page, value) => {
  await page.locator(`#presetScope input[value="${value}"]`).locator('..').click();
  await expect(page.locator(`#presetScope input[value="${value}"]`)).toBeChecked();
};
async function open(page) {
  if (!await page.locator('.header-preset-picker').evaluate(node => node.open)) await page.locator('.header-preset-picker summary').click();
}
async function visibleIds(page) {
  await open(page);
  return page.locator('.header-preset-picker button[data-preset-id]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.presetId));
}
async function choose(page, id) {
  await open(page); await page.locator(`button[data-preset-id="${id}"]`).click();
}
const ids = form => HAND_PRESETS.filter(p => form === 'both' || p.snapshot.form === form).map(p => p.id);
async function dice(page, seed) {
  return page.evaluate(seed => {
    window.__scopeDiceSeed = seed;
    try { document.querySelector('.header-preset-random').click(); } finally { delete window.__scopeDiceSeed; }
    return window.__gesticulatingHand.snapshot();
  }, seed);
}

test.beforeEach(async ({page}) => {
  page.scopeErrors = []; page.on('pageerror', error => page.scopeErrors.push(error.message));
  await page.addInitScript(() => {
    const random = Math.random;
    Math.random = () => window.__scopeDiceSeed === undefined ? random()
      : ((window.__scopeDiceSeed = (Math.imul(window.__scopeDiceSeed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  });
  await page.goto('gesticules.html');
  await page.waitForFunction(() => window.__gesticulatingHand?.snapshot().loaded);
});
test.afterEach(async ({page}) => expect(page.scopeErrors).toEqual([]));

test('scope filters the menu while preserving the current scene and the mixed preset order', async ({page}) => {
  const before = await snapshot(page);
  await expect(page.getByRole('group', {name: 'Models for presets and dice'})).toBeVisible();
  await expect(page.getByRole('radio', {name: 'Both', exact: true})).toBeChecked();
  expect(await visibleIds(page)).toEqual(ids('both'));
  for (const form of ['foot', 'hand', 'both']) {
    await scope(page, form); expect(await visibleIds(page)).toEqual(ids(form));
    const after = await snapshot(page);
    expect(after.config).toEqual(before.config); expect(after.time).toBe(before.time);
    expect(after.presetScope).toBe(form); expect(after.audio.contextState).toBe('uninitialized');
    await expect(page.locator('.header-preset-picker summary')).toContainText('Finger loom');
    const capture = await page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
    expect(capture.snapshot).toEqual(before.config); expect(capture.presetCount).toBe(68); expect(capture.selectedId).toBe('wire-roll');
  }
  expect((await visibleIds(page))[63]).toBe('gesture-middle-finger');
  const accessibility = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('Next and keyboard Previous skip the other model, wrap, and retain exact factory scenes', async ({page}) => {
  for (const form of ['foot', 'hand']) {
    const choices = ids(form);
    await scope(page, form); await choose(page, choices.at(-1));
    await page.locator('.header-preset-next').click();
    expect((await snapshot(page)).config).toEqual(HAND_PRESETS.find(p => p.id === choices[0]).snapshot);
    await expect(page.locator(`#presetScope input[value="${form}"]`)).toBeChecked();
    await page.locator('.header-preset-next').press('ArrowLeft');
    expect((await snapshot(page)).config).toEqual(HAND_PRESETS.find(p => p.id === choices.at(-1)).snapshot);
    // Hidden stale buttons cannot load a scene excluded by the model scope.
    const other = ids(form === 'hand' ? 'foot' : 'hand')[0], before = await snapshot(page);
    await page.locator(`button[data-preset-id="${other}"]`).evaluate(button => button.click());
    expect((await snapshot(page)).config).toEqual(before.config);
  }
});

test('search intersects with model scope and radio arrows change scope without loading a preset', async ({page}) => {
  await scope(page, 'foot'); await open(page);
  await page.locator('.header-preset-picker input[type="search"]').fill('wire');
  const expected = HAND_PRESETS.filter(p => p.snapshot.form === 'foot' && `${p.label} ${p.description ?? p.label}`.toLowerCase().includes('wire')).map(p => p.id);
  expect(await visibleIds(page)).toEqual(expected);
  await page.locator('.header-preset-picker summary').click();
  const before = await snapshot(page);
  await page.getByRole('radio', {name: 'Foot', exact: true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', {name: 'Both', exact: true})).toBeChecked();
  expect((await snapshot(page)).config).toEqual(before.config);
  expect(await visibleIds(page)).toEqual(ids('both'));
});

test('dice uses the selected model and Both restores the original mixed random stream', async ({page}) => {
  for (const form of ['foot', 'hand', 'both']) {
    await scope(page, form);
    for (const seed of [72, 74, 79, 4203543429]) {
      const after = await dice(page, seed);
      // Compare in the same JS runtime: sin/pow can differ by a few ULPs
      // between Chrome and Node while retaining the identical random stream.
      const expected = await page.evaluate(async ({seed, form}) => {
        const {randomizeHandConfig} = await import('/src/instruments/gesticulating-hand/hand-model.js');
        let value = seed;
        return randomizeHandConfig(undefined, () => ((value = Math.imul(value, 1664525) + 1013904223 | 0) >>> 0) / 2 ** 32, form);
      }, {seed, form});
      expect(after.config).toEqual(expected);
      expect(after.presetScope).toBe(form); expect(after.audio.contextState).toBe('uninitialized');
      if (form !== 'both') expect(after.config.form).toBe(form);
      await expect(page.locator('.header-preset-picker summary')).toContainText('Custom');
    }
  }
});

test('changing scope is silent and leaves armed players, held notes, levels and clocks alone', async ({page}) => {
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.running).toBe(true);
  for (const form of ['foot', 'hand', 'both']) await scope(page, form);
  const silent = await sampleAudioEnvelope(page, {durationMs: 250, intervalMs: 40});
  expect(silent.summary.maxPeak).toBeLessThan(.00001);
  await page.locator('#outputLevel').evaluate(node => {node.value='.29';node.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#soundPlayButton').click(); await page.locator('#motionButton').click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('morphazoid:midi-input', {cancelable: true,
    detail: {routeId: 'gesticulating-hand', message: {type:'noteOn',note:60,velocity:80,sourceId:'scope-test',channel:0}}})));
  const before = await snapshot(page);
  for (const form of ['foot', 'hand', 'both']) {
    await scope(page, form); const after = await snapshot(page);
    expect(after.config).toEqual(before.config); expect(after.held).toBe(1);
    expect(after.audioOn && after.playing && after.soundPlaying).toBe(true); expect(after.time).toBeGreaterThanOrEqual(before.time);
    await expect(page.locator('#outputLevel')).toHaveValue('0.29');
  }
  for (const form of ['hand','foot']) {
    await scope(page, form); await dice(page, 72);
    await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
    expect((await snapshot(page)).config.form).toBe(form);
    await expect(page.locator('#outputLevel')).toHaveValue('0.29');
  }
});

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390},{width:320,height:568}]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000});
    test('scope stays with presets above Play and is reachable while the stage stays pinned', async ({page}, testInfo) => {
      await scope(page, 'foot'); await page.evaluate(() => scrollTo(0,0));
      const geometry = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return {scope:box('#presetScope'),presets:box('.instrument-preset-controls'),picker:box('.header-preset-picker'),play:box('.hand-transports'),stage:box('#handStage'),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};
      });
      expect(geometry.scope.bottom).toBeLessThanOrEqual(geometry.picker.top);
      expect(geometry.presets.bottom).toBeLessThanOrEqual(geometry.play.top + 1);
      expect(geometry.presets.bottom).toBeLessThan(geometry.height);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
      if (viewport.width < 1000) {
        expect(Math.abs(geometry.presets.top - geometry.stage.bottom)).toBeLessThanOrEqual(2);
        await page.locator('#tempo').scrollIntoViewIfNeeded();
        const top = await page.locator('#handStage').evaluate(node => node.getBoundingClientRect().top);
        expect(Math.abs(top - geometry.stage.top)).toBeLessThanOrEqual(1);
      }
      await page.screenshot({path:testInfo.outputPath('preset-scope.png')});
    });
  });
}
