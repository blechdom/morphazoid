import { expect, test } from '@playwright/test';
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const route = '/blech-midi-ultra.html';

test('the fluorescent Ultra logo appears immediately after BLECH MIDI in Faves', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/index.html');
  await settlePage(page);
  const faves = page.locator('.catalogue-group[data-category-id="faves"] .instrument-card');
  const ids = await faves.evaluateAll(cards => cards.map(card => card.dataset.instrumentId));
  expect(ids[ids.indexOf('blech-midi') + 1]).toBe('blech-midi-ultra');
  const ultra = page.locator('.catalogue-group[data-category-id="faves"] .instrument-card[data-instrument-id="blech-midi-ultra"]');
  await expect(ultra.locator('.instrument-card-title')).toHaveText('BLECH MIDI ULTRA');
  await ultra.scrollIntoViewIfNeeded();
  const icon = ultra.locator('img.instrument-card-image');
  await expect(icon).toHaveAttribute('src', 'assets/instruments/blech-midi-ultra.webp');
  await expect.poll(() => icon.evaluate(image => image.complete && image.naturalWidth === 512)).toBe(true);
  const fluorescentPixels = await icon.evaluate(image => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 130 && pixels[index + 1] > 220 && pixels[index + 2] < 95) count++;
    }
    return count;
  });
  expect(fluorescentPixels).toBeGreaterThan(3_000);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('ULTRA loads its own BLECH modules; the original still opens independently', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  const requested = [];
  page.on('request', request => requested.push(new URL(request.url()).pathname));
  await page.goto(route);
  await settlePage(page);
  await expect(page).toHaveTitle('BLECH MIDI ULTRA — Morphazoid');
  await expect(page.getByRole('heading', { name: 'BLECH MIDI ULTRA', exact: true })).toBeVisible();
  await expect(page.locator('.masthead .tabs .instrument-picker-current')).toHaveText('BLECH MIDI ULTRA');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await expect(page.locator('.blech-drop-overlay')).toBeVisible();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(requested).toContain('/src/instruments/blech-midi-ultra/blech-midi-app.js');
  expect(requested).toContain('/src/instruments/blech-midi-ultra/blech-midi-math.js');
  expect(requested.some(path => path.startsWith('/src/instruments/blech-midi/'))).toBe(false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);

  const original = await page.context().newPage();
  try {
    const originalDiagnostics = watchPageDiagnostics(original, { baseURL });
    await original.goto('/blech-midi.html');
    await settlePage(original);
    await expect(original.getByRole('heading', { name: 'BLECH MIDI', exact: true })).toBeVisible();
    await expect(original.locator('#blechDropSend')).toBeEnabled();
    await expect(original.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(await original.locator('#blechMidiTitle').evaluate(node => getComputedStyle(node).color)).toBe('rgb(150, 244, 204)');
    expect(pageDiagnosticMessages(originalDiagnostics)).toEqual([]);
  } finally {
    await original.close();
  }
});

test('the logo green reaches the toolbar, rails and workbox, with pink for removal', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto(route);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const look = await page.evaluate(() => {
    const color = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
    return {
      accent: getComputedStyle(document.body).getPropertyValue('--blech-acid').trim(),
      red: getComputedStyle(document.body).getPropertyValue('--blech-red').trim(),
      title: color('#blechMidiTitle', 'color'),
      titleShadow: color('#blechMidiTitle', 'textShadow'),
      activeTool: color('#blechTab-math', 'backgroundColor'),
      drop: color('#blechDropSend', 'backgroundColor'),
      frame: color('.blech-drop-handle', 'borderTopColor'),
      trash: color('#blechToolClear', 'color'),
      rail: color('.blech-note-rail', 'backgroundColor'),
      palette: document.querySelector('[data-palette]').value,
    };
  });
  const originalLogo = await page.request.get('/assets/blech-midi/blech-mark.svg');
  expect(originalLogo.ok()).toBe(true);
  const originalRed = (await originalLogo.text()).match(/<g fill="(#[0-9a-f]{6})"/i)?.[1];
  expect(look.red).toBe(originalRed);
  expect(look).toMatchObject({
    accent: '#c7ff2a',
    red: '#ff2532',
    title: 'rgb(255, 37, 50)',
    titleShadow: 'none',
    activeTool: 'rgb(199, 255, 42)',
    drop: 'rgb(199, 255, 42)',
    frame: 'rgb(199, 255, 42)',
    trash: 'rgb(255, 79, 146)',
    rail: 'rgb(59, 66, 61)',
    palette: 'ultra',
  });
  await page.locator('#blechDropSend').click();
  await page.locator('#blechLayersToggle').click();
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(1);
  expect(await page.locator('#blechLiveLayers .blech-live-layer').evaluate(node => node.style.getPropertyValue('--blech-layer-ink'))).toBe('#c7ff2a');
  await page.locator('#blechLayersToggle').click();
  await page.locator('#blechToolErase').click();
  await page.locator('#blechToolErase').hover();
  expect(await page.locator('#blechToolErase').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 79, 146)');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('ULTRA Drop makes a layer, while Free Draw and either rail remain live-only', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto(route);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const layers = page.locator('#blechLiveLayers .blech-live-layer');
  await expect(layers).toHaveCount(0);
  await page.locator('#blechDropSend').click();
  await expect(layers).toHaveCount(1);
  await page.locator('#blechMasterPlay').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#blechMasterPlay').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('[data-spigot-mode="draw"]').click();
  const canvas = await page.locator('.blech-spigot-paint').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * .28, canvas.y + canvas.height * .4);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .38, canvas.y + canvas.height * .5, { steps: 6 });
  await page.mouse.up();
  await expect(layers).toHaveCount(1);

  const rail = await page.locator('.blech-note-rail').boundingBox();
  await page.mouse.click(rail.x + rail.width * .6, rail.y + rail.height / 2);
  await expect(page.locator('.blech-note-rail-marker')).toHaveCount(1);
  await expect(layers).toHaveCount(1);
  // A quick second click is the rail's sustain gesture, not its remove action.
  await page.waitForTimeout(600);
  await page.locator('.blech-note-rail-marker').click();
  await expect(page.locator('.blech-note-rail-marker')).toHaveCount(0);

  const comb = await page.locator('[data-comb-surface]').boundingBox();
  const crossing = await page.locator('[data-rail-crossing]').boundingBox();
  await page.mouse.click(comb.x + comb.width / 2, crossing.y + crossing.height + 25);
  await expect(layers).toHaveCount(1);
  await page.locator('#blechToolClear').click();
  await expect(layers).toHaveCount(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('the longer title, transport and Audio remain reachable at desktop and phone sizes', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const touch = viewport.width !== 1440;
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
    try {
      const page = await context.newPage();
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto(route);
      await expect(page.locator('#blechDropSend')).toBeEnabled();
      const layout = await page.evaluate(() => {
        const rect = selector => {
          const { left, top, right, bottom } = document.querySelector(selector).getBoundingClientRect();
          return { left, top, right, bottom };
        };
        return {
          title: rect('#blechMidiTitle'),
          counter: rect('#blechNoteCounters'),
          play: rect('#blechMasterPlay'),
          audio: rect('#audioButton'),
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      for (const key of ['title', 'counter', 'play', 'audio']) {
        expect(layout[key].left, `${viewport.width}px: ${key} left`).toBeGreaterThanOrEqual(-1);
        expect(layout[key].right, `${viewport.width}px: ${key} right`).toBeLessThanOrEqual(viewport.width + 1);
        expect(layout[key].top, `${viewport.width}px: ${key} top`).toBeGreaterThanOrEqual(-1);
        expect(layout[key].bottom, `${viewport.width}px: ${key} bottom`).toBeLessThanOrEqual(viewport.height + 1);
      }
      expect(layout.overflow, `${viewport.width}px: document overflow`).toBeLessThanOrEqual(1);
      expect(
        layout.title.right <= layout.counter.left || layout.counter.top >= layout.title.bottom - 1,
        `${viewport.width}px: title and trip counter overlap`,
      ).toBe(true);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
