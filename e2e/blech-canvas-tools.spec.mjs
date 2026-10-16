import { test, expect } from '@playwright/test';

// Exercise the viewport's callback contract with real stamp artwork. The app
// owns note generation and playback; this fixture never constructs audio.
async function openTools(page) {
  await page.route('**/__blech-canvas-tools-qa.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi.css"><link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi-spigots.css"></head><body style="margin:12px;background:#07090b"><div id="tools"></div><div id="view" style="position:relative;width:min(780px,calc(100vw - 24px));height:500px;background:#080d10"></div></body></html>` }));
  await page.goto('/__blech-canvas-tools-qa.html');
  await page.evaluate(async () => {
    const [{ mountBlechSpigots }, { MIXER_SAMPLE_STAMPS, mixerStampScore }, { parseMidi }] = await Promise.all([
      import('/src/instruments/blech-midi/blech-midi-spigots.js'),
      import('/src/instruments/midi-mixer/midi-mixer-performance-score.js'),
      import('/src/instruments/midi-mixer/midi-mixer-model.js'),
    ]);
    const entries = MIXER_SAMPLE_STAMPS.map(entry => {
      const score = mixerStampScore(entry.id, { beats: 2, span: 30 }); score.analysis = parseMidi(score.buffer);
      return { ...entry, score, notes: score.analysis.notes, durationBeats: score.analysis.durationBeats };
    });
    const q = globalThis.__toolsQA = { entries, layers: [], starts: [], moves: [], ends: [], latches: [], selectedStamp: 'heart', serial: 0 };
    const makeLayer = () => {
      const layer = { id: `layer-${++q.serial}`, name: `Drawing ${q.serial}`, score: entries[0].score,
        settings: { delayBeats: 1, loop: true }, playing: true, active: true };
      q.layers.push(layer); return layer.id;
    };
    q.view = mountBlechSpigots(document.querySelector('#view'), {
      controlsHost: document.querySelector('#tools'), getLayers: () => q.layers,
      getPreparedScore: () => ({ score: entries.find(entry => entry.id === q.selectedStamp).score, settings: { loop: true } }),
      getStampEntries: () => entries, getSelectedStampId: () => q.selectedStamp,
      onSelectStamp: async id => { q.selectedStamp = id; },
      onBrushStart: options => { q.starts.push({ mode: options.mode, sourceId: options.sourceId }); return options.mode === 'erase' ? options.sourceId : makeLayer(); },
      onBrushMove: (id, point) => q.moves.push({ id, ...point }),
      onBrushEnd: (id, options) => q.ends.push({ id, ...options }),
      onEdit: (id, patch) => Object.assign(q.layers.find(layer => layer.id === id).settings, patch),
      onLatch: options => { q.latches.push({ replaceIds: options.replaceIds }); q.layers = q.layers.filter(layer => !options.replaceIds.includes(layer.id)); return makeLayer(); },
    });
  });
}
const snapshot = page => page.evaluate(() => ({ starts: __toolsQA.starts, moves: __toolsQA.moves, ends: __toolsQA.ends, latches: __toolsQA.latches,
  ids: __toolsQA.layers.map(layer => layer.id), mode: __toolsQA.view.getMode(), selection: __toolsQA.view.getSelection(), selectedStamp: __toolsQA.selectedStamp }));
async function canvasPoint(page, x = .65, y = .35) {
  const rect = await page.locator('.blech-spigot-paint').boundingBox(); return { x: rect.x + rect.width * x, y: rect.y + rect.height * y };
}

for (const phone of [false, true]) test(`SVG tools and real stamp thumbnail grid are accessible on ${phone ? 'phone' : 'desktop'}`, async ({ page }) => {
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await openTools(page);
  for (const name of ['Pencil', 'Eraser']) await expect(page.getByRole('button', { name, exact: true }).locator('svg')).toHaveCount(1);
  await expect(page.locator('[data-spigot-mode="select"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toBeDisabled();
  const stamp = page.locator('[data-spigot-mode="stamp"]');
  await expect(stamp.locator('svg')).toHaveCount(1);
  await stamp.focus(); await page.keyboard.press('Enter');
  const panel = page.locator('.blech-spigot-stamp-grid'); await expect(panel).toBeVisible();
  const choices = panel.locator('[data-stamp-id]'); expect(await choices.count()).toBeGreaterThan(20);
  const thumbs = await choices.locator('canvas').evaluateAll(nodes => new Set(nodes.map(node => node.toDataURL())).size);
  expect(thumbs).toBeGreaterThan(15);
  const boxes = await choices.evaluateAll(nodes => nodes.slice(0, 4).map(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y }; }));
  expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThanOrEqual(1);
  expect(boxes[3].x).toBeGreaterThan(boxes[0].x);
  const bounds = await panel.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual((await page.viewportSize()).width);
  await page.getByRole('searchbox', { name: 'Filter canvas stamps' }).fill('zigzag');
  await page.keyboard.press('Enter');
  await expect(panel).toBeHidden(); await expect(stamp).toHaveAttribute('aria-pressed', 'true');
  expect(await snapshot(page)).toMatchObject({ selectedStamp: 'zigzag', mode: 'stamp' });
  await expect(page.locator('.blech-spigot-editor, [data-spigot-field]')).toHaveCount(0);
});

test('Pencil stays armed with an editable rectangle and Eraser targets only its selected layer', async ({ page }) => {
  await openTools(page); await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const p = await canvasPoint(page); await page.mouse.click(p.x, p.y);
  const first = await snapshot(page); expect(first.ids).toHaveLength(1); expect(first.selection).toBe(first.ids[0]); expect(first.mode).toBe('draw');
  await expect(page.locator('.blech-spigot-move')).toBeVisible();
  const square = await page.locator('.blech-spigot-move').boundingBox();
  await page.mouse.click(square.x + square.width / 2, square.y + square.height / 2);
  const second = await snapshot(page); expect(second.ids).toHaveLength(2); expect(second.selection).toBe(second.ids[1]);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  const before = (await snapshot(page)).moves.length;
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  const erased = await snapshot(page); expect(erased.ids).toEqual(second.ids); expect(erased.selection).toBe(second.ids[1]);
  expect(erased.starts.at(-1)).toEqual({ mode: 'erase', sourceId: second.ids[1] });
  expect(erased.ends.at(-1)).toMatchObject({ id: second.ids[1], cancelled: false });
  expect(erased.moves).toHaveLength(before);
});

test('double-click sustain replaces only its own two click gestures and leaves earlier drawings alone', async ({ page }) => {
  await openTools(page); await page.getByRole('button', { name: 'Pencil', exact: true }).click();
  const p = await canvasPoint(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 25, p.y + 10, { steps: 4 }); await page.mouse.up();
  const prior = (await snapshot(page)).ids[0];
  await page.mouse.dblclick(p.x, p.y, { delay: 40 });
  const after = await snapshot(page);
  expect(after.latches).toHaveLength(1); expect(after.latches[0].replaceIds).toHaveLength(2);
  expect(after.latches[0].replaceIds).not.toContain(prior);
  expect(after.ids).toHaveLength(2); expect(after.ids[0]).toBe(prior);
  expect(after.selection).toBe(after.ids[1]); expect(after.mode).toBe('draw');
  await expect(page.locator('.blech-spigot-editor')).toHaveCount(0);
});
