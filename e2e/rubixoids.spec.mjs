import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { enforceRubixoidsOwnership } from './helpers/rubixoids-ownership.mjs';

enforceRubixoidsOwnership(test, expect);
import { installFakeMidi, enableFakeMidi, sendMidiSequence } from './helpers/fake-midi.mjs';

const MIGRATION = JSON.parse(await readFile(new URL('../tests/fixtures/rubixoids-migration-inventory.json', import.meta.url), 'utf8'));

const NATIVE = Object.freeze({
  '2d': { id: 'sliding-puzzle', path: '/sliding-puzzle.html', voice: 'soundBank', stage: '#puzzleFrame', controls: ['rows', 'columns', 'squareLock', 'rotateRight', 'autoSlide', 'scale', 'microStrum', 'neighborResponse'] },
  '3d': { id: 'rubix', path: '/rubix.html', voice: 'soundBank', stage: '#stage', controls: ['shape', 'rubixSize', 'randomTwists', 'moveRight', 'simdPreset', 'stickerModulation', 'acidLevel', 'drumLevel'] },
  '4d': { id: 'hyper-rubix', path: '/hyper-rubix.html', voice: 'voice', stage: '#stage', controls: ['sequenceMethod', 'playbackPreset', 'hyperbarGrid', 'facePicker', 'planePicker', 'topologyMode', 'topologyStrum', 'decayLink', 'projectionDepth'] },
});

const mainAudio = page => page.locator('body > .masthead #audioButton');
const mainPlay = page => page.locator('.rubixoids-pane:not([hidden]) #playButton');
const snapshot = page => page.evaluate(() => window.__rubixoidsSnapshot());
const setRange = (view, id, value) => view.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

async function nativeView(page, dimension) {
  const view = page.locator(`.rubixoids-pane[data-dimension="${dimension}"]`);
  await expect(view).toBeAttached();
  await expect(view.locator('#playButton')).toBeAttached();
  await expect(view).toBeVisible();
  await expect(mainAudio(page)).toBeEnabled();
  return view;
}

async function selectDimension(page, dimension) {
  await page.locator(`.rubixoids-dimensions button[data-dimension="${dimension}"]`).click();
  await expect.poll(async () => (await snapshot(page)).dimension).toBe(dimension);
  const view = await nativeView(page, dimension);
  await expect(view).toBeVisible();
  await expect(mainAudio(page)).toBeEnabled();
  return view;
}

const capturePreset = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import('/src/site/header-presets.js');
  return captureHeaderPresetState();
});

async function nativeInventory(page, dimension) {
  return page.evaluate(async dimension => {
    const { root } = (await import('/src/instruments/rubixoids/rubixoids-app.js')).rubixoidsInstrument(dimension);
    return {
      ids: Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id, node.tagName.toLowerCase()])),
      controls: [...root.querySelectorAll('main input[id], main select[id], main button[id]')].map(node => node.id).sort(),
      selects: Object.fromEntries([...root.querySelectorAll('main select[id]')].map(select => [select.id,
        [...select.options].map(option => option.value)])),
      presets: [...root.querySelectorAll('.header-preset-picker [data-full-preset]')].map(button => button.dataset.presetId),
    };
  }, dimension);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Rubixoids keeps native performance controls reachable at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    test.setTimeout(90000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const pageRequests = [];
    page.on('request', request => pageRequests.push(new URL(request.url()).pathname));
    await page.setViewportSize(viewport);
    await page.goto('/rubixoids.html');
    await expect.poll(async () => (await snapshot(page)).dimension).toBe('3d');
    let headerLayout;
    for (const dimension of ['3d', '2d', '4d']) {
      const view = await selectDimension(page, dimension);
      expect(new URL(page.url()).pathname).toBe('/rubixoids.html');
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect(page.locator('.masthead')).toHaveCount(1);
      await expect(page.locator('.midi-toolbar')).toHaveCount(1);
      await expect(page.locator('body > .masthead .header-settings-menu .midi-toolbar')).toHaveCount(1);
      await page.locator('body > .masthead .header-settings-trigger').click();
      await expect(page.locator('.midi-toolbar')).toBeVisible();
      await page.locator('body > .masthead .header-settings-trigger').click();
      await expect(view.locator('.masthead, .midi-toolbar')).toHaveCount(0);
      await expect(page.locator('.midi-output-monitor')).toHaveCount(1);
      await expect(view.locator('.panel > .midi-output-monitor')).toHaveAttribute('data-route-id', NATIVE[dimension].id);
      await expect(page.locator('body > .midi-output-monitor')).toHaveCount(0);
      const masthead = await page.locator('body > .masthead').boundingBox();
      const dimensionbar = await page.locator('.rubixoids-bar').boundingBox();
      expect(dimensionbar.y).toBeGreaterThanOrEqual(masthead.y + masthead.height - 1);
      const layout = await page.evaluate(() => Object.fromEntries([
        'body > .masthead', '.wordmark', '.tabs.tools-nav', '.header-io-controls',
        '.header-output-meter-shell', '.audio-strip',
        '.header-settings-menu', '.rubixoids-bar',
      ].map(selector => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return [selector, { x, y, width, height }];
      })));
      headerLayout ??= layout;
      expect(layout, `${dimension}: shared menu geometry stays fixed`).toEqual(headerLayout);
      await expect(page.locator('body > .masthead .header-preset-controls')).toHaveCount(0);
      expect(await view.evaluate(pane => pane.shadowRoot?.host === pane)).toBe(true);
      for (const id of NATIVE[dimension].controls) await expect(view.locator(`#${id}`)).toBeAttached();
      await expect(view.locator(`#${NATIVE[dimension].voice} option[value="shared-simd-chiptune"]`)).toHaveCount(1);
      await expect(mainAudio(page)).toBeVisible();
      await expect(mainPlay(page)).toBeVisible();
      await expect(page.locator('.rubixoids-bar input, .rubixoids-bar #playButton')).toHaveCount(0);
      await expect(view.locator('#tempo')).toBeVisible();
      await expect(view.locator('#swing')).toBeVisible();
      for (const selector of ['#playButton', `#${NATIVE[dimension].voice}`]) {
        await view.locator(selector).scrollIntoViewIfNeeded();
        await expect(view.locator(selector)).toBeVisible();
      }
      if (dimension !== '2d') {
        await expect(page.locator('.header-preset-picker')).toBeVisible();
        expect((await capturePreset(page)).instrumentId).toBe(dimension === '3d' ? 'rubix' : 'hyper-rubix');
        expect((await capturePreset(page)).presetCount).toBeGreaterThanOrEqual(12);
      } else {
        await expect(page.locator('.header-preset-controls')).toHaveCount(0);
      }
      expect(await view.evaluate(pane => { const shell = pane.shadowRoot.querySelector('main'); return shell.scrollWidth <= pane.clientWidth + 1; })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await view.locator(NATIVE[dimension].stage).screenshot({ path: info.outputPath(`${dimension}.png`) });
    }
    expect(pageRequests.filter(path => Object.values(NATIVE).some(native => native.path === path))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('Rubixoids retains the migration inventory of controls, voices and presets independently', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/rubixoids.html');
  for (const dimension of Object.keys(NATIVE)) {
    await selectDimension(page, dimension);
    const original = MIGRATION.dimensions[dimension];
    const mounted = await nativeInventory(page, dimension);
    for (const [id, tag] of Object.entries(original.ids)) expect(mounted.ids[id], `${dimension}: ${id}`).toBe(tag);
    for (const id of original.controls) expect(mounted.controls, `${dimension}: ${id}`).toContain(id);
    for (const [id, options] of Object.entries(original.selects)) {
      for (const option of options) expect(mounted.selects[id], `${dimension}: ${id}=${option}`).toContain(option);
    }
    for (const presetId of original.presets) expect(mounted.presets, `${dimension}: ${presetId}`).toContain(presetId);
  }
});

test('3D turns show intermediate geometry before committing and undo restores the score', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/rubixoids.html');
  const view = await nativeView(page, '3d');
  await expect(view.locator('#moveRight')).toBeEnabled();
  const animation = await page.evaluate(async () => {
    const { rubixPlaybackSnapshot } = await import('/src/instruments/rubixoids/rubix/rubix-app.js');
    const read = () => {
      const state = rubixPlaybackSnapshot();
      return { score: JSON.stringify(state.scoreIds), geometry: JSON.stringify(state.geometry), camera: state.camera };
    };
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = read();
    const frames = [];
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    rubixoidsInstrument('3d').root.getElementById('moveRight').click();
    const start = performance.now();
    while (performance.now() - start < 500) {
      await new Promise(requestAnimationFrame);
      frames.push(read());
    }
    return { before, frames, after: read() };
  });
  expect(animation.frames.some(view => view.score === animation.before.score && view.geometry !== animation.before.geometry)).toBe(true);
  expect(new Set(animation.frames.map(view => view.geometry)).size).toBeGreaterThan(3);
  expect(animation.after.score).not.toBe(animation.before.score);
  expect(animation.after.camera).toEqual(animation.before.camera);
  await view.locator('#undoMove').click();
  await expect.poll(async () => page.evaluate(async () => {
    const { rubixPlaybackSnapshot } = await import('/src/instruments/rubixoids/rubix/rubix-app.js');
    return JSON.stringify(rubixPlaybackSnapshot().scoreIds);
  })).toBe(animation.before.score);
});

test('Dimensional switches preserve puzzle edits, native mappings, projection and undo history', async ({ page }) => {
  await page.goto('/rubixoids.html');
  const cube = await nativeView(page, '3d');
  await cube.locator('#moveRight').click();
  await expect(cube.locator('#undoMove')).toBeEnabled();
  await cube.locator('#shape').selectOption('stella');
  const cubeState = (await capturePreset(page)).snapshot;
  const sliding = await selectDimension(page, '2d');
  await sliding.locator('.sliding-tile.can-slide').first().click();
  await sliding.locator('#rotateRight').click();
  const readTiles = view => view.locator('#puzzleBoard').evaluate(board => [...board.querySelectorAll('[data-tile-id]')].map(tile => ({
    id: tile.dataset.tileId, row: tile.getAttribute('aria-rowindex'), column: tile.getAttribute('aria-colindex'),
  })));
  const tiles = await readTiles(sliding);
  const rotation = await sliding.locator('#rotationOut').textContent();
  const hyper = await selectDimension(page, '4d');
  await hyper.locator('#sequenceMethod').selectOption('sticker-hyperbar');
  await hyper.locator('details[data-section="sound"] > summary').click();
  await hyper.locator('#topologyMode').selectOption({ index: 1 });
  await hyper.locator('#hyperbarGrid button:not(:disabled)').first().click();
  await hyper.locator('#turnClockwise').click();
  await expect(hyper.locator('#undoMove')).toBeEnabled();
  const hyperState = (await capturePreset(page)).snapshot;
  expect(Object.keys(hyperState.gateOverrides).length).toBeGreaterThan(0);
  await selectDimension(page, '3d');
  const cubeReturn = (await capturePreset(page)).snapshot;
  expect(cubeReturn.cube).toEqual(cubeState.cube);
  expect(cubeReturn.shapeId).toBe('stella');
  expect(cubeReturn.camera).toEqual(cubeState.camera);
  await expect(cube.locator('#undoMove')).toBeEnabled();
  await selectDimension(page, '2d');
  expect(await readTiles(sliding)).toEqual(tiles);
  expect(await sliding.locator('#rotationOut').textContent()).toBe(rotation);
  await expect(sliding.locator('#undoMove')).toBeEnabled();
  await selectDimension(page, '4d');
  const hyperReturn = (await capturePreset(page)).snapshot;
  expect(hyperReturn.puzzle).toEqual(hyperState.puzzle);
  expect(hyperReturn.gateOverrides).toEqual(hyperState.gateOverrides);
  expect(hyperReturn.settings.sequenceMethod).toBe('sticker-hyperbar');
  expect(hyperReturn.settings.topologyMode).toBe(hyperState.settings.topologyMode);
  await expect(hyper.locator('#undoMove')).toBeEnabled();
  // Repeated visits without edits must not reinterpret Hyper's native sequence
  // method or silently replace its hand-edited gates with another dimension's mode.
  for (const dimension of ['3d', '2d', '4d']) await selectDimension(page, dimension);
  const hyperSecondReturn = (await capturePreset(page)).snapshot;
  expect(hyperSecondReturn.puzzle).toEqual(hyperState.puzzle);
  expect(hyperSecondReturn.gateOverrides).toEqual(hyperState.gateOverrides);
  expect(hyperSecondReturn.settings.sequenceMethod).toBe('sticker-hyperbar');
  expect(hyperSecondReturn.settings.topologyMode).toBe(hyperState.settings.topologyMode);
});

test('Shared tempo and Chiptune follow live switches while only the active instrument sounds', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html');
  const cube = await nativeView(page, '3d');
  await setRange(cube, 'tempo', 159);
  await setRange(page.locator('body > .masthead'), 'output', .43);
  await expect(cube.locator('#output')).toHaveValue('0.43');
  await cube.locator('#soundBank').selectOption('shared-simd-chiptune');
  await mainPlay(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'false');
  expect((await readAudioStatus(page)).active).toBe(false);
  await mainAudio(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
  await mainPlay(page).click();
  for (const dimension of ['3d', '2d', '4d', '3d']) {
    const view = await selectDimension(page, dimension);
    await expect(view.locator('#tempo')).toHaveValue('159');
    await expect(view.locator('#output')).toHaveValue('0.43');
    await expect(page.locator('body > .masthead #output')).toHaveValue('0.43');
    await expect(view.locator(`#${NATIVE[dimension].voice}`)).toHaveValue('shared-simd-chiptune');
    await expect(view.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
    const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    for (const other of Object.keys(NATIVE).filter(id => id !== dimension)) {
      const pane = page.locator(`.rubixoids-pane[data-dimension="${other}"]`);
      if (!await pane.count()) continue;
      const state = (await snapshot(page)).dimensions[other];
      expect(state.diagnostics.contextState, `${other} must be parked`).not.toBe('running');
      expect(state.diagnostics.schedulerActive, `${other} scheduler must be parked`).toBe(false);
      await expect(pane).toBeHidden();
      expect(await pane.evaluate(node => node.inert)).toBe(true);
    }
  }
  await mainAudio(page).click();
  await expect(cube.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('4D defaults to opaque projected sticker faces and retains selectable glass rendering', async ({ page }, info) => {
  await page.addInitScript(() => {
    const fills = [];
    const stops = new WeakMap();
    const nativeStop = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function (offset, color) {
      const list = stops.get(this) ?? [];
      list.push(String(color)); stops.set(this, list);
      return nativeStop.call(this, offset, color);
    };
    const nativeFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      if (this.canvas.id === 'stage' && this.canvas.getRootNode().host?.dataset.dimension === '4d') {
        fills.push({ alpha: this.globalAlpha, color: typeof this.fillStyle === 'string' ? this.fillStyle : null, stops: stops.get(this.fillStyle) ?? [] });
        if (fills.length > 4000) fills.splice(0, 1000);
      }
      return nativeFill.apply(this, args);
    };
    window.__rubixoidsCanvasProbe = () => fills;
  });
  await page.goto('/rubixoids.html?dimension=4d');
  const view = await selectDimension(page, '4d');
  await expect(view.locator('#stickerAppearance')).toHaveValue('solid');
  await expect(view.locator('#stage')).toHaveAttribute('data-sticker-appearance', 'solid');
  await expect.poll(async () => page.evaluate(() => window.__rubixoidsCanvasProbe().filter(fill => fill.color === '#030405' && fill.alpha === 1).length)).toBeGreaterThan(20);
  const gradients = await page.evaluate(() => window.__rubixoidsCanvasProbe().filter(fill => fill.stops.length));
  expect(gradients.length).toBeGreaterThan(20);
  for (const fill of gradients) {
    expect(fill.alpha).toBe(1);
    for (const color of fill.stops) {
      // rgb()/hex stops are opaque; rgba() may only have an alpha of one.
      expect(color).not.toMatch(/rgba\([^)]*,\s*(?:0(?:\.\d+)?|\.\d+)\s*\)/);
    }
  }
  await view.locator('#stage').screenshot({ path: info.outputPath('4d-solid-stickers.png') });
  await view.locator('details[data-section="hyperspace"] > summary').click();
  await view.locator('#stickerAppearance').selectOption('glass');
  await expect(view.locator('#stage')).toHaveAttribute('data-sticker-appearance', 'glass');
  await view.locator('#stickerAppearance').selectOption('solid');
});


test('An Audio click followed immediately by a dimension switch survives slow engine preparation', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/rubixoids.html');
  const sliding = await selectDimension(page, '2d');
  await page.route('**/*.wasm', async route => {
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.continue();
  });
  await sliding.locator('#soundBank').selectOption('shared-simd-chiptune');
  await mainAudio(page).click();
  await selectDimension(page, '3d');
  await expect.poll(async () => (await snapshot(page)).dimensions['3d'].audioOn).toBe(true);
  const state = await snapshot(page);
  expect(state.dimensions['2d'].audioOn).toBe(true);
  expect(state.dimensions['2d'].contextState).toBe('suspended');
});

test('A pending native 303 engine change retains Play through a dimension switch', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/rubixoids.html');
  await selectDimension(page, '2d');
  const cube = await selectDimension(page, '3d');
  await page.evaluate(async () => {
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    await rubixoidsInstrument('3d').bridge.applySettings({ acidEngine: 'web-audio', soundBank: 'acid-303' });
  });
  await mainAudio(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
  await mainPlay(page).click();
  await expect(cube.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.route('**/*.wasm', async route => {
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.continue();
  });
  await cube.locator('#acidEngine').selectOption('simd-303');
  const sliding = await selectDimension(page, '2d');
  await expect(sliding.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  const state = await snapshot(page);
  expect(state.dimensions['3d'].playing).toBe(true);
  expect(state.dimensions['3d'].contextState).toBe('suspended');
});


test('Native MIDI stays available while a hidden dimension ignores incoming notes and controls', async ({ page }) => {
  await installFakeMidi(page);
  await page.goto('/rubixoids.html');
  await selectDimension(page, '3d');
  await enableFakeMidi(page);
  await page.locator('body > .masthead .header-settings-trigger').click();
  await selectDimension(page, '2d');
  const before = (await snapshot(page)).dimensions['3d'];
  await sendMidiSequence(page, [
    { data: [0x90, 60, 100] }, { data: [0xb0, 1, 100] },
    { data: [0xc0, 2] }, { data: [0xfa] }, { data: [0x80, 60, 0] },
  ], { settleFrames: 0 });
  const after = (await snapshot(page)).dimensions['3d'];
  expect(after.settings).toEqual(before.settings);
  expect(after.native.cube).toEqual(before.native.cube);
  expect(after.contextState).toBe('suspended');
  await selectDimension(page, '3d');
  await expect(page.locator('body > .masthead #sharedMidiToggle')).toHaveAttribute('aria-pressed', 'true');
});

test('4D full presets recall their exact native score and voice while Audio and Play continue', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html?dimension=4d');
  const view = await nativeView(page, '4d');
  await mainAudio(page).click();
  await mainPlay(page).click();
  const presetIds = await page.evaluate(async () => {
    const { HYPER_RUBIX_FULL_PRESETS } = await import('/src/instruments/rubixoids/hyper-rubix/full-presets.js');
    return HYPER_RUBIX_FULL_PRESETS.map(({ id }) => id);
  });
  for (const id of presetIds) {
    const result = await page.evaluate(async id => {
      const { captureHeaderPresetState } = await import('/src/site/header-presets.js');
      const { HYPER_RUBIX_FULL_PRESETS } = await import('/src/instruments/rubixoids/hyper-rubix/full-presets.js');
      const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
      const instrument = rubixoidsInstrument('4d');
      instrument.root.querySelector(`[data-full-preset][data-preset-id="${id}"]`).click();
      return {
        actual: captureHeaderPresetState(), expected: HYPER_RUBIX_FULL_PRESETS.find(preset => preset.id === id).snapshot,
        native: instrument.bridge.capture(), voice: instrument.root.getElementById('voice').value,
      };
    }, id);
    expect(result.actual.instrumentId, id).toBe('hyper-rubix');
    expect(result.actual.selectedId, id).toBe(id);
    expect(result.actual.snapshot, id).toEqual(result.expected);
    expect(result.voice, id).toBe(result.expected.settings.voice);
    expect(result.native.playing, id).toBe(true);
    expect(result.native.audioOn, id).toBe(true);
    expect(result.native.diagnostics.schedulerActive, id).toBe(true);
    await page.waitForTimeout(90);
  }

  await view.locator('[data-preset-id="single-cell-bell"]').evaluate(button => button.click());
  await expect(view.locator('#playbackPreset')).toBeEnabled();
  await expect(view.locator('#playbackPreset')).toHaveValue('selected-cell');
  const read = await page.evaluate(async () => {
    const { hyperRubixCellForNormal } = await import('/src/instruments/rubixoids/hyper-rubix/hyper-rubix.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    const instrument = rubixoidsInstrument('4d');
    const cells = new Set(), stickers = new Set();
    const manager = getSharedAudioOutputManager(globalThis);
    let peak = 0;
    for (let count = 0; count < 50; count++) {
      const native = instrument.bridge.capture();
      const id = instrument.root.getElementById('stage').dataset.currentSoundingStickerId;
      const sticker = native.native.puzzle.stickers.find(sticker => sticker.id === id);
      if (sticker) { stickers.add(id); cells.add(hyperRubixCellForNormal(sticker.normal).id); }
      peak = Math.max(peak, manager.getStatus().peak);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    return { cells: [...cells], stickers: [...stickers], peak, native: instrument.bridge.capture() };
  });
  expect(read.cells).toEqual(['y-']);
  expect(read.stickers.length).toBeGreaterThan(1);
  expect(read.peak).toBeGreaterThan(0.001);
  expect(read.peak).toBeLessThan(1);
  expect(read.native.playing).toBe(true);
  expect(read.native.audioOn).toBe(true);
  expect(errors).toEqual([]);
});


test('Page-transition lifecycle fixture preserves native state and sound through cache parking and final teardown', async ({ page }) => {
  // Synthetic PageTransitionEvents check controller ownership mechanically;
  // they do not claim real browser BFCache navigation acceptance.
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const captureMounted = () => page.evaluate(async () => {
    const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
    return Object.fromEntries(['2d', '3d', '4d'].flatMap(dimension => {
      const instance = rubixoidsInstrument(dimension);
      if (!instance) return [];
      const state = instance.bridge.capture();
      return [[dimension, {
        active: state.active, playing: state.playing, audioOn: state.audioOn,
        contextState: state.diagnostics.contextState,
        schedulerActive: state.diagnostics.schedulerActive,
        musical: instance.context.presets?.capture() ?? state.settings,
        puzzle: state.native.puzzle ?? state.native.cube,
        history: state.native.history ?? state.native.moveHistory,
      }]];
    }));
  });
  await page.goto('/rubixoids.html');
  for (const dimension of ['3d', '2d', '4d']) {
    const view = await selectDimension(page, dimension);
    if (dimension === '3d') await view.locator('#moveRight').click();
    else if (dimension === '2d') await view.locator('.sliding-tile.can-slide').first().click();
    else await view.locator('#turnClockwise').click();
    await expect.poll(async () => (await captureMounted())[dimension].history.length).toBe(1);
  }

  for (const dimension of ['2d', '3d', '4d']) {
    await selectDimension(page, dimension);
    if (dimension === '2d') {
      await mainAudio(page).click();
      await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
      await mainPlay(page).click();
    }
    await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
    const before = await captureMounted();
    const beforeSound = await sampleAudioEnvelope(page, { durationMs: 350 });
    expect(beforeSound.summary.maxPeak, `${dimension}: sounding before parking`).toBeGreaterThan(.001);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expect.poll(async () => Object.values(await captureMounted()).every(state => (
      !state.active && !state.schedulerActive && ['none', 'suspended'].includes(state.contextState)
    ))).toBe(true);
    const parked = await captureMounted();
    for (const key of Object.keys(before)) {
      expect(parked[key].musical, `${dimension}: parked ${key} parameters`).toEqual(before[key].musical);
      expect(parked[key].puzzle, `${dimension}: parked ${key} puzzle`).toEqual(before[key].puzzle);
      expect(parked[key].history, `${dimension}: parked ${key} history`).toEqual(before[key].history);
      expect(parked[key].audioOn).toBe(before[key].audioOn);
      expect(parked[key].playing).toBe(before[key].playing);
    }
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(async () => {
      const state = (await captureMounted())[dimension];
      return state.active && state.audioOn && state.playing && state.schedulerActive && state.contextState === 'running';
    }).toBe(true);
    await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
    const restored = await captureMounted();
    for (const key of Object.keys(before)) {
      expect(restored[key].musical, `${dimension}: restored ${key} parameters`).toEqual(before[key].musical);
      expect(restored[key].puzzle, `${dimension}: restored ${key} puzzle`).toEqual(before[key].puzzle);
      expect(restored[key].history, `${dimension}: restored ${key} history`).toEqual(before[key].history);
      expect(restored[key].active).toBe(key === dimension);
      if (key !== dimension) expect(restored[key].schedulerActive).toBe(false);
    }
    const resumedSound = await sampleAudioEnvelope(page, { durationMs: 350 });
    expect(resumedSound.summary.finite).toBe(true);
    expect(resumedSound.summary.maxPeak, `${dimension}: sounding after restoration`).toBeGreaterThan(.001);
  }

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => Object.values(await captureMounted()).every(state => (
    state.contextState === 'none' && !state.schedulerActive
  ))).toBe(true);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});
