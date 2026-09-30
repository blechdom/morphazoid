import { expect, test } from '@playwright/test';

const live = new Set(['speed', 'pitch', 'ring', 'brightness', 'soundVariation']);
const limits = [
  ['count', 4, 1024, 16], ['size', .1, 6, 1.12], ['spacing', .12, 2.5, .54],
  ['sizeVariation', 0, 1, .1], ['growth', -2, 2, 0], ['stairRise', -1, 1, .09],
  ['rotation', -180, 180, 0], ['stretch', .2, 5, 1], ['curvature', .2, 3, 1],
  ['speed', .05, 12, 1], ['pitch', -36, 36, 0], ['brightness', 0, 1, .43],
  ['standDelay', .05, 60, 1.5],
];
const read = page => page.evaluate(() => ({ snapshot: window.dominoRun.snapshot, run: window.dominoRun.run,
  timeline: window.dominoRun.timeline, time: window.dominoRun.time, playing: window.dominoRun.playing, audio: window.dominoRun.audio }));
async function open(page) {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  await expect(page.locator('#rotation')).toBeAttached();
}
async function settled(page, key, value) {
  await expect.poll(() => page.evaluate(key => window.dominoRun.snapshot.params[key], key)).toBe(value);
  if (!live.has(key)) await expect.poll(() => page.evaluate(key => window.dominoRun.run.params[key], key)).toBe(value);
}
async function range(page, key, value) {
  // Public native range/value/events; no instrument-state setters.
  await page.locator(`#${key}`).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await settled(page, key, value);
}
async function activate(locator, touch) {
  await locator.scrollIntoViewIfNeeded();
  if (touch) await locator.tap(); else await locator.click();
}
async function fits(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#stage').getBoundingClientRect();
    return window.dominoRun.targets.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= 0 && point.x <= canvas.width && point.y >= 0 && point.y <= canvas.height);
  });
}
const span = page => page.evaluate(() => {
  const points = window.dominoRun.targets;
  return Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
});
const signature = fall => ({ id: fall.id, start: fall.start, duration: fall.duration, kick: fall.kick, times: fall.times });

for (const profile of [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, touch: false },
  { name: 'portrait touch', viewport: { width: 390, height: 844 }, touch: true },
  { name: 'landscape touch', viewport: { width: 844, height: 390 }, touch: true },
]) {
  test.describe(profile.name, () => {
    test.use({ viewport: profile.viewport, hasTouch: profile.touch, isMobile: profile.touch });
    test('expanded native endpoints are reachable, synchronized, finite, and readable', async ({ page }) => {
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await open(page); await range(page, 'count', 16);
      if (profile.touch) expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      for (const [key, min, max, baseline] of limits) {
        if (key === 'standDelay') await page.locator('#autoStand').check();
        const input = page.locator(`#${key}`), output = page.locator(`output[for="${key}"]`);
        await expect(input).toHaveAttribute('min', String(min));
        await expect(input).toHaveAttribute('max', String(max));
        for (const [button, value] of [['End', max], ['Home', min]]) {
          await input.scrollIntoViewIfNeeded(); await input.press(button); await settled(page, key, value);
          expect(await output.evaluate(element => element.scrollWidth <= element.clientWidth), `${key} output fits at ${value}`).toBe(true);
          const state = await read(page);
          expect(state.run.dominoes.length).toBeLessThanOrEqual(1024);
          if (key === 'count') expect(state.run.dominoes.length).toBe(value);
          expect(state.run.dominoes.every(tile => [tile.x, tile.z, tile.elevation, tile.height, tile.width, tile.depth, tile.angle].every(Number.isFinite)
            && tile.height >= .03 && tile.height <= 64)).toBe(true);
        }
        await range(page, key, baseline);
        if (key === 'standDelay') await page.locator('#autoStand').uncheck();
      }
      await page.locator('#direction').selectOption('reverse'); await settled(page, 'direction', 'reverse');
      await page.locator('#direction').selectOption('forward'); await settled(page, 'direction', 'forward');
      await activate(page.locator('#selectedDomino summary'), profile.touch);
      const tileSize = page.locator('#tileSize');
      for (const [key, value] of [['End', 64], ['Home', .03]]) {
        await tileSize.scrollIntoViewIfNeeded(); await tileSize.press(key);
        await expect.poll(() => page.evaluate(() => window.dominoRun.run.dominoes.find(tile => tile.id === window.dominoRun.selected).height)).toBeCloseTo(value, 8);
      }
      expect(await page.evaluate(() => {
        const panel = document.querySelector('.domino-panel');
        return document.documentElement.scrollWidth <= innerWidth + 1 && panel.scrollWidth <= panel.clientWidth + 1;
      })).toBe(true);
      expect((await read(page)).audio.armed).toBe(false);
      expect(errors).toEqual([]);
    });

    test('overall size visibly changes the scene and Fit recovers extreme zoom and tile height', async ({ page }) => {
      await open(page);
      for (const [key, value] of [['count', 16], ['size', 1], ['sizeVariation', 0], ['growth', 0]]) await range(page, key, value);
      await activate(page.locator('#fitView'), profile.touch);
      const before = await span(page);
      await range(page, 'size', 3);
      await expect.poll(() => span(page)).toBeGreaterThan(before * 2.4);
      await activate(page.locator('#fitView'), profile.touch);
      await expect.poll(() => fits(page)).toBe(true);
      const recovered = await span(page);
      expect(recovered / before).toBeGreaterThan(.9); expect(recovered / before).toBeLessThan(1.1);
      await activate(page.locator('#selectedDomino summary'), profile.touch);
      await page.locator('#tileSize').press('End');
      await expect.poll(() => page.evaluate(() => window.dominoRun.run.dominoes[0].height)).toBe(64);
      for (let i = 0; i < 16; i++) await activate(page.locator('#zoomIn'), profile.touch);
      await activate(page.locator('#fitView'), profile.touch);
      await expect.poll(() => fits(page)).toBe(true);
      if (profile.touch) {
        const fit = await page.locator('#fitView').boundingBox();
        expect(fit.width).toBeGreaterThanOrEqual(48); expect(fit.height).toBeGreaterThanOrEqual(48);
      }
      expect((await read(page)).playing).toBe(false);
    });
  });
}

test('extreme size and slow speed retain additive waves, and shape/preset/random edits keep transport active', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  for (const [key, value] of [['count', 16], ['size', 6], ['spacing', 2.5], ['sizeVariation', 0], ['growth', 0], ['speed', .05]]) await range(page, key, value);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#stage').press('Enter');
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(.015);
  const first = await read(page), prior = first.timeline.falls.filter(fall => fall.start <= first.time).map(signature);
  await page.locator('#stage').press('ArrowRight'); await page.locator('#stage').press('Enter');
  let state = await read(page);
  expect(state.timeline.falls.some(fall => fall.id === 1 && fall.start <= state.time)).toBe(true);
  for (const fall of prior) expect(state.timeline.falls.map(signature)).toContainEqual(fall);
  const geometry = state.run.dominoes, launched = state.timeline.falls.map(signature);
  await range(page, 'pitch', 36); await range(page, 'soundVariation', 1);
  state = await read(page);
  expect(state.run.dominoes).toEqual(geometry);
  for (const fall of launched) expect(state.timeline.falls.map(signature)).toContainEqual(fall);
  expect(state.time).toBeGreaterThanOrEqual(first.time - .01);
  const links = state.run.links.map(link => `${link.from}:${link.to}`).sort();
  await page.locator('#direction').selectOption('reverse'); await settled(page, 'direction', 'reverse');
  expect((await read(page)).run.links.map(link => `${link.to}:${link.from}`).sort()).toEqual(links);
  for (const [key, value] of [['rotation', 180], ['stretch', 5], ['curvature', 3]]) await range(page, key, value);
  expect((await read(page)).run.dominoes).not.toEqual(geometry);
  const shapes = await page.locator('#layout option').evaluateAll(options => options.map(option => option.value).filter(value => value !== 'drawn'));
  for (const shape of shapes) {
    await page.locator('#layout').selectOption(shape); await settled(page, 'layout', shape);
    const current = await read(page);
    expect(current.playing).toBe(true); expect(current.audio.armed).toBe(true);
    expect(current.run.dominoes.every(tile => [tile.x, tile.z, tile.height, tile.elevation].every(Number.isFinite))).toBe(true);
    await page.locator('#fitView').click(); await expect.poll(() => fits(page)).toBe(true);
  }
  for (const action of [async () => {
    await page.locator('.header-preset-picker summary').click();
    await page.locator('#header-preset-panel button[data-preset-id="tone-henge"]').click();
  }, async () => page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click(), async () => page.locator('#newRun').click()]) {
    await action();
    state = await read(page);
    expect(state.playing).toBe(true); expect(state.audio.armed).toBe(true);
    expect(state.snapshot.params.loop).toBe(true); expect(state.snapshot.params.autoStand).toBe(false);
    expect(state.run.dominoes.length).toBeGreaterThanOrEqual(4); expect(state.run.dominoes.length).toBeLessThanOrEqual(1024);
  }
  expect(errors).toEqual([]);
});

test('drawing keeps large authored coordinates through shape transforms and caps the run at 1024 pieces', async ({ page }) => {
  await open(page); await range(page, 'size', 6);
  await page.locator('#fitView').click();
  for (let i = 0; i < 20; i++) await page.locator('#zoomOut').click();
  await page.locator('[data-mode="draw"]').click(); await page.locator('#newPattern').click();
  await range(page, 'size', .1); await range(page, 'spacing', .12);
  await range(page, 'rotation', 90); await range(page, 'stretch', 2);
  const stage = page.locator('#stage'); await stage.scrollIntoViewIfNeeded(); const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .5); await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(box.x + box.width * (.2 + .6 * i / 24), box.y + box.height * .5);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.dominoRun.run.dominoes.length)).toBe(1024);
  const before = await read(page), authored = before.snapshot.drawing;
  expect(Math.max(...authored.strokes.flatMap(stroke => stroke.points.flatMap(point => [Math.abs(point.x), Math.abs(point.z)])))).toBeGreaterThan(150);
  expect(before.run.truncated).toBe(true);
  await range(page, 'rotation', -135); await range(page, 'stretch', 5);
  await page.locator('#direction').selectOption('reverse'); await settled(page, 'direction', 'reverse');
  const after = await read(page);
  expect(after.snapshot.drawing).toEqual(authored);
  expect(after.run.dominoes).not.toEqual(before.run.dominoes);
  expect(after.run.links.map(link => `${link.to}:${link.from}`).sort()).toEqual(before.run.links.map(link => `${link.from}:${link.to}`).sort());
  await expect(page.locator('#curvature')).toBeDisabled();
  await page.locator('#fitView').click(); await expect.poll(() => fits(page)).toBe(true);
  expect(after.audio.armed).toBe(false);
});


for (const launch of ['Run', 'MIDI Start']) test(`${launch} uses reversed roots even during a pending layout rebuild`, async ({ page }) => {
  await open(page);
  for (const layout of ['serpentine', 'fork', 'tapestry']) {
    await page.locator('#resetAll').click();
    await page.locator('#layout').selectOption(layout);
    await settled(page, 'layout', layout);
    const result = await page.evaluate(launch => {
      const direction = document.querySelector('#direction');
      direction.value = 'reverse'; direction.dispatchEvent(new Event('change', { bubbles: true }));
      if (launch === 'Run') document.querySelector('#playButton').click();
      else window.dispatchEvent(new CustomEvent('morphazoid:midi-input', { detail: { message: { type: 'start' } } }));
      return { roots: window.dominoRun.run.roots, first: window.dominoRun.timeline.falls.filter(fall => fall.start === 0).map(fall => fall.id),
        reachable: window.dominoRun.timeline.reachableCount, count: window.dominoRun.run.dominoes.length, armed: window.dominoRun.audio.armed };
    }, launch);
    expect(result.first.sort((a,b) => a-b)).toEqual(result.roots.sort((a,b) => a-b));
    expect(result.reachable).toBe(result.count);
    expect(result.armed).toBe(false);
  }
});


test('1024 mixed-material dominoes sound through the maximum-speed run without dropping scheduled impacts', async ({ page }) => {
  await open(page);
  await page.locator('.header-preset-picker summary').click();
  await page.locator('#header-preset-panel button[data-preset-id="thousand-clacks"]').click();
  await range(page, 'speed', 12);
  await page.locator('#loop').uncheck();
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  const expected = await page.evaluate(() => window.dominoRun.timeline.events.length);
  expect(expected).toBe(2047);
  await expect.poll(() => page.evaluate(() => window.dominoRun.audio.played), { timeout: 15000 }).toBe(expected);
  const state = await read(page);
  expect(state.audio.dropped).toBe(0);
  expect(state.audio.active).toBeLessThanOrEqual(96);
  expect(state.audio.buffers).toBeLessThanOrEqual(256);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});
