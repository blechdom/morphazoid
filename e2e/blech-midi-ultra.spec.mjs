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
  const titleFont = await page.locator('#blechMidiTitle').evaluate(async title => {
    await document.fonts.ready;
    return {
      family: getComputedStyle(title).fontFamily,
      loaded: [...document.fonts].some(face => face.family === 'DSEG14 Classic Mini' && face.status === 'loaded'),
    };
  });
  expect(titleFont.family).toContain('DSEG14 Classic Mini');
  expect(titleFont.loaded).toBe(true);
  await expect(page.locator('.masthead .tabs .instrument-picker-current')).toHaveText('BLECH MIDI ULTRA');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await expect(page.locator('.blech-drop-overlay')).toBeVisible();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(requested).toContain('/src/instruments/blech-midi-ultra/blech-midi-app.js');
  expect(requested).toContain('/src/instruments/blech-midi-ultra/blech-midi-math.js');
  expect(requested).toContain('/assets/blech-midi-ultra/DSEG14ClassicMini-Bold.woff2');
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

test('the logo lime, original BLECH red and fluorescent turquoise reach the performance UI', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto(route);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const look = await page.evaluate(() => {
    const color = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
    return {
      accent: getComputedStyle(document.body).getPropertyValue('--blech-acid').trim(),
      red: getComputedStyle(document.body).getPropertyValue('--blech-red').trim(),
      turquoise: getComputedStyle(document.body).getPropertyValue('--blech-turquoise').trim(),
      mixerB: getComputedStyle(document.querySelector('#blechMidi')).getPropertyValue('--mixer-b').trim(),
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
    turquoise: '#32ffdf',
    mixerB: '#32ffdf',
    title: 'rgb(255, 37, 50)',
    titleShadow: 'none',
    activeTool: 'rgb(199, 255, 42)',
    drop: 'rgb(199, 255, 42)',
    frame: 'rgb(199, 255, 42)',
    trash: 'rgb(255, 37, 50)',
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
  expect(await page.locator('#blechToolErase').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(255, 37, 50)');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('the trip-meter plunger resets the note count without stopping a playing layer', async ({ page, baseURL }) => {
  test.setTimeout(50_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto(route);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const reset = page.locator('#blechResetNoteCount');
  await expect(reset).toHaveAttribute('title', /trip-meter button/);
  await expect(reset.locator('svg rect')).toHaveCount(1);
  await expect(reset.locator('svg ellipse')).toHaveCount(0);
  // Clicking Audio outside the workbox tucks its draft. Drop while the box is
  // visible, then arm Audio explicitly without stopping the saved loop.
  await expect(page.locator('#blechDropLoop')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#blechDropSend').click();
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(1);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect(page.locator('#blechMasterPlay')).toHaveAttribute('aria-pressed', 'true');
  const notes = page.locator('#blechNotesPlayed');
  const count = async () => Number((await notes.textContent()).replaceAll(',', ''));
  await expect.poll(count, { timeout: 10_000 }).toBeGreaterThan(10);
  const afterReset = await reset.evaluate(button => {
    const before = Number(document.querySelector('#blechNotesPlayed').textContent.replaceAll(',', ''));
    button.click();
    return {
      before, count: Number(document.querySelector('#blechNotesPlayed').textContent.replaceAll(',', '')),
      playing: document.querySelector('#blechMasterPlay').getAttribute('aria-pressed'),
      layers: document.querySelectorAll('#blechLiveLayers .blech-live-layer').length,
    };
  });
  expect(afterReset).toMatchObject({ playing: 'true', layers: 1 });
  expect(afterReset.before).toBeGreaterThan(10);
  // The loop can play again in the very audio quantum in which Reset lands.
  // Count new attacks normally, without requiring a transient zero frame.
  expect(afterReset.count).toBeLessThan(5);
  await expect.poll(count, { timeout: 10_000 }).toBeGreaterThan(afterReset.count);
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
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    const touch = viewport.width !== 1440;
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
    try {
      const page = await context.newPage();
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto(route);
      await expect(page.locator('#blechDropSend')).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
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
          wordGap: (() => {
            const text = document.querySelector('#blechMidiTitle').lastChild;
            const word = (start, end) => {
              const range = document.createRange();
              range.setStart(text, start); range.setEnd(text, end);
              return range.getBoundingClientRect();
            };
            return word(6, 10).left - word(0, 5).right;
          })(),
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
      expect(layout.wordGap, `${viewport.width}px: the title has a visible word gap`).toBeGreaterThan(5);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('Free Text turns the complete MIDI word and typing cursor 90° on desktop and phones', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    const touch = viewport.width !== 1440;
    const context = await browser.newContext({ viewport, isMobile: touch, hasTouch: touch });
    try {
      const page = await context.newPage();
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto(route);
      await expect(page.locator('#blechDropSend')).toBeEnabled();
      await page.locator('#blechTab-text').click();
      const overlay = page.locator('.blech-free-text-overlay'), input = page.locator('#blechFreeTextInput');
      await expect(overlay).toBeVisible();
      await expect(page.locator('#blechFreeTextFont')).toHaveValue('digital');
      const box = await overlay.boundingBox();
      const x = box.x + box.width * .3, y = box.y + box.height * .82;
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await input.fill('BLECH');
      await expect.poll(async () => Number(await overlay.getAttribute('data-note-count'))).toBeGreaterThan(0);
      const inkBounds = () => overlay.locator('canvas').evaluate(canvas => {
        const { width, height } = canvas;
        const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
        let left = width, right = -1, top = height, bottom = -1;
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
          if (pixels[(row * width + column) * 4 + 3] < 100) continue;
          left = Math.min(left, column); right = Math.max(right, column);
          top = Math.min(top, row); bottom = Math.max(bottom, row);
        }
        return { width: right - left + 1, height: bottom - top + 1 };
      });
      const horizontal = await inkBounds();
      if (viewport.width === 1440) {
        await page.locator('#blechFreeTextSize').selectOption('3');
        await expect.poll(async () => Number(await overlay.getAttribute('data-note-count'))).toBeGreaterThan(0);
      }
      await page.locator('[data-free-text-direction="vertical"]').click();
      await expect(input).toHaveAttribute('data-orientation', 'vertical');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const vertical = await inkBounds();
      expect(vertical.width, `${viewport.width}px: rotated notes span fewer pitches`).toBeLessThan(horizontal.width);
      expect(vertical.height, `${viewport.width}px: rotated notes span more time`).toBeGreaterThan(horizontal.height);
      const layout = await input.evaluate(node => {
        const rect = element => element.getBoundingClientRect().toJSON();
        return {
          writingMode: getComputedStyle(node).writingMode,
          input: rect(node),
          toolbar: rect(node.closest('.blech-free-text-overlay').querySelector('.blech-free-text-toolbar')),
          channel: rect(document.querySelector('#blechFreeTextChannel')),
          volume: rect(document.querySelector('#blechFreeTextVolume')),
        };
      });
      expect(layout.writingMode).toBe('sideways-lr');
      expect(layout.input.height).toBeGreaterThan(layout.input.width);
      for (const part of [layout.input, layout.toolbar, layout.channel, layout.volume]) {
        expect(part.left).toBeGreaterThanOrEqual(0);
        expect(part.top).toBeGreaterThanOrEqual(0);
        expect(part.right).toBeLessThanOrEqual(viewport.width + 1);
        expect(part.bottom).toBeLessThanOrEqual(viewport.height + 1);
      }
      await input.press('Enter');
      await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(1);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      if (!touch) {
        await page.locator('#blechLayersToggle').click();
        await page.locator('#blechLiveLayers .blech-live-layer [data-layer-mix]').click();
        await page.locator('#blechLiveLayers .blech-live-layer [data-layer-edit]').click();
        await expect(input).toHaveValue('BLECH');
        await expect(page.locator('[data-free-text-direction="vertical"]')).toHaveAttribute('aria-pressed', 'true');
        const extreme = await page.evaluate(async () => {
          const { prepareFreeTextMidi } = await import('/src/instruments/blech-midi-ultra/blech-midi-text-controls.js');
          const { parseMidi } = await import('/src/instruments/midi-mixer/midi-mixer-model.js');
          const score = prepareFreeTextMidi('W'.repeat(32), {
            pitch: 127, size: 4, font: 'digital', orientation: 'vertical',
          });
          const analysis = parseMidi(score.buffer);
          return { text: score.lines.map(line => line.text).join(''), font: score.textSettings.font, beats: score.layout.beats,
            duration: analysis.durationBeats, rightEdge: score.layout.lowestNote + score.layout.span,
            high: Math.max(...analysis.notes.map(note => note.note)),
            count: analysis.noteCount };
        });
        expect(extreme).toMatchObject({ text: 'W'.repeat(32), font: 'digital', rightEdge: 128 });
        expect(extreme.duration).toBe(extreme.beats);
        expect(extreme.beats).toBeGreaterThan(0);
        expect(extreme.beats).toBeLessThanOrEqual(64);
        expect(extreme.high).toBeLessThanOrEqual(127);
        expect(extreme.count).toBeGreaterThan(0);
      }
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('Free Text keeps each square note font legible and routes pre-drop channel and volume through editing', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto(route);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await page.locator('#blechTab-text').click();
  const overlay = page.locator('.blech-free-text-overlay');
  const box = await overlay.boundingBox();
  await page.mouse.click(box.x + box.width * .25, box.y + box.height * .35);
  const input = page.locator('#blechFreeTextInput');
  await input.fill('BLECH');
  const font = page.locator('#blechFreeTextFont'), channel = page.locator('#blechFreeTextChannel');
  const volume = page.locator('#blechFreeTextVolume'), readout = page.locator('#blechFreeTextVolumeOut');
  expect(await font.locator('option').evaluateAll(options => options.map(option => option.textContent)))
    .toEqual(['Digital', 'Arcade', 'Square', 'Chunky']);
  const signatures = [];
  for (const face of ['digital', 'pixel', 'square', 'chunky']) {
    await font.selectOption(face);
    await expect.poll(async () => Number(await overlay.getAttribute('data-note-count'))).toBeGreaterThan(0);
    signatures.push(await overlay.locator('canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let index = 3; index < pixels.length; index += 4) hash = (Math.imul(hash, 31) + pixels[index]) | 0;
      return hash;
    }));
  }
  expect(new Set(signatures).size).toBe(4);
  await font.selectOption('square');
  await channel.selectOption('3');
  await volume.focus();
  await volume.press('Home');
  await expect(readout).toHaveText('0');
  await volume.press('ArrowRight');
  await expect(readout).toHaveText('1');
  await volume.evaluate(node => { node.value = '32'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(readout).toHaveText('32');
  await input.press('Enter');
  await page.locator('#blechLayersToggle').click();
  const layer = page.locator('#blechLiveLayers .blech-live-layer').first();
  await expect(layer).toBeVisible();
  await layer.locator('[data-layer-mix]').click();
  await layer.locator('[data-layer-loop]').check();
  await expect(layer.locator('[data-layer-channel]')).toHaveValue('3');
  expect(Number(await layer.locator('[data-layer-gain]').inputValue())).toBeCloseTo(32 / 127, 1);
  await layer.locator('[data-layer-edit]').click();
  await expect(input).toHaveValue('BLECH');
  await expect(font).toHaveValue('square');
  await expect(channel).toHaveValue('3');
  await expect(readout).toHaveText('32');

  // A Layers mix change must be reflected in the editor before the next Drop.
  await layer.locator('[data-layer-channel]').selectOption({ value: '5' });
  await expect(layer.locator('[data-layer-channel]')).toHaveValue('5');
  await layer.locator('[data-layer-gain]').evaluate(node => { node.value = '.5'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(layer.locator('[data-layer-channel]')).toHaveValue('5');
  await layer.locator('[data-layer-edit]').click();
  await expect(channel).toHaveValue('5');
  await expect(readout).toHaveText('64');
  await channel.selectOption('6');
  await volume.evaluate(node => { node.value = '0'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await input.fill('LOUD');
  await input.press('Enter');
  await expect(layer.locator('[data-layer-channel]')).toHaveValue('6');
  await expect(layer.locator('[data-layer-gain]')).toHaveValue('0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('Text workboxes offer the same four whole-note faces in a zoomed draft and inside a box', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto(route);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await page.locator('#blechTab-text').focus();
  await page.locator('#blechTab-text').press('ArrowDown');
  await page.locator('#blechTextAdvanced').click();
  const advanced = page.locator('#blechTextFont');
  const faces = ['digital', 'pixel', 'square', 'chunky'];
  expect(await advanced.locator('option').evaluateAll(options => options.map(option => option.value))).toEqual(faces);
  await page.locator('[name="blechTextAlign"][value="left"]').check();
  await page.locator('#blechTextMessage').fill('L');
  for (const face of faces) {
    await advanced.selectOption(face);
    await expect(page.locator('#blechTextDrop')).toBeEnabled();
  }
  const firstInk = await page.locator('#blechTextPreview').evaluate(canvas => {
    const { width, height } = canvas, pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const index = (y * width + x) * 4;
      if (pixels[index + 1] > 180 && pixels[index] > 80) return x / width;
    }
    return null;
  });
  expect(firstInk).not.toBeNull();
  expect(firstInk).toBeLessThan(.1);
  await page.locator('#blechTab-workbox').click();
  await page.locator('[data-stage-text]').click();
  const workbox = page.locator('#blechDropTextFont');
  await expect(workbox).toBeVisible();
  expect(await workbox.locator('option').evaluateAll(options => options.map(option => option.value))).toEqual(faces);
  await workbox.selectOption('chunky');
  await page.locator('#blechDropText').fill('HI');
  await page.locator('#blechDropTextMenu [type="submit"]').click();
  await expect(page.locator('[data-stage-text]')).toHaveAttribute('aria-pressed', 'true');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
