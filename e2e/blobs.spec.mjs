import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

const scene = page => page.evaluate(() => JSON.parse(localStorage.getItem('morphazoid:blobs:v4')));
async function open(page) {
  await page.goto('/blobs.html');
  await expect(page.locator('#selectedBlob option')).toHaveCount(1);
  await expect(page.locator('.header-preset-next')).toBeVisible();
  await expect(page.locator('[data-tool="edit"]')).toHaveAttribute('aria-pressed', 'true');
}
async function position(page, x, y) {
  const box = await page.locator('#stage').boundingBox();
  const size = Math.max(1, Math.min(box.width - 32, box.height - 92));
  return { x: box.x + (box.width - size) / 2 + x * size, y: box.y + 58 + (box.height - 92 - size) / 2 + y * size };
}
async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => { input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState(document));
async function clickPoint(page, x, y) { const p = await position(page, x, y); await page.mouse.click(p.x, p.y); }

function curvePoint(blob, segment, t) {
  const a = blob.points[segment], b = blob.points[(segment + 1) % blob.points.length], u = 1 - t;
  if (blob.tool !== 'pen') return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  return {
    x: u ** 3 * a.x + 3 * u * u * t * (a.x + a.hx) + 3 * u * t * t * (b.x + (b.inHx ?? -b.hx)) + t ** 3 * b.x,
    y: u ** 3 * a.y + 3 * u * u * t * (a.y + a.hy) + 3 * u * t * t * (b.y + (b.inHy ?? -b.hy)) + t ** 3 * b.y,
  };
}
function expectMidpointSplitPreservesCurve(before, after, segment) {
  expect(after.points).toHaveLength(before.points.length + 1);
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, expected = curvePoint(before, segment, t);
    const actual = curvePoint(after, segment + (t > .5 ? 1 : 0), t > .5 ? (t - .5) * 2 : t * 2);
    expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(.0001);
  }
  // Every segment outside the split remains intact, including the closing curve.
  for (let i = 0; i < before.points.length; i++) if (i !== segment) {
    const expected = curvePoint(before, i, .37), actual = curvePoint(after, i > segment ? i + 1 : i, .37);
    expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(.0001);
  }
}
async function dragPoint(page, from, dx, dy, { alt = false, cancel = null } = {}) {
  const p = await position(page, from.x, from.y);
  await page.mouse.move(p.x, p.y);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 });
  if (cancel === 'Escape') await page.keyboard.press('Escape');
  else if (cancel === 'pointercancel') await page.locator('#stage').dispatchEvent('pointercancel');
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

test('three drawing tools create closed playable loops, edit/undo and persistence work', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page); await page.locator('#clearAll').click();
  const start = await position(page, .2, .3); await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (const [x, y] of [[.5, .2], [.75, .4], [.6, .7], [.25, .6]]) { const p = await position(page, x, y); await page.mouse.move(p.x, p.y, { steps: 8 }); }
  await page.mouse.up(); expect((await scene(page)).blobs).toHaveLength(1);
  await page.locator('[data-tool="line"]').click();
  for (const [x, y] of [[.3, .3], [.7, .3], [.5, .7], [.3, .3]]) await clickPoint(page, x, y);
  expect((await scene(page)).blobs).toHaveLength(2);
  await page.locator('[data-tool="pen"]').click();
  const p = await position(page, .3, .4); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 50, p.y - 30); await page.mouse.up();
  await clickPoint(page, .7, .4); await clickPoint(page, .5, .75); await page.locator('#closePath').click();
  expect((await scene(page)).blobs[2].points[0].hx).toBeGreaterThan(0);
  await page.locator('[data-tool="edit"]').click();
  const before = await scene(page), a = await position(page, .3, .4);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 25, a.y + 20); await page.mouse.up();
  expect((await scene(page)).blobs[2].points[0].x).not.toBe(before.blobs[2].points[0].x);
  await page.locator('#undo').click(); expect((await scene(page)).blobs).toEqual(before.blobs);
  await page.reload(); await expect(page.locator('#selectedBlob option')).toHaveCount(3);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('keyboard drawing and pointer cancellation leave valid contours', async ({ page }) => {
  await open(page); await page.locator('#clearAll').click(); await page.locator('[data-tool="line"]').click();
  await page.locator('#stage').focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter'); await page.keyboard.press('c');
  expect((await scene(page)).blobs).toHaveLength(1);
  const before = await scene(page); await page.locator('[data-tool="edit"]').click();
  const p = await position(page, .5, .5); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 40, p.y + 30);
  await page.locator('#stage').dispatchEvent('pointercancel'); await page.mouse.up();
  expect((await scene(page)).blobs).toEqual(before.blobs);
});

test('Audio is explicit; transport, live edits and pause produce bounded output', async ({ page }) => {
  await open(page); await page.locator('#playButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  const envelope = await sampleAudioEnvelope(page);
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.maxPeak).toBeGreaterThan(.001); expect(envelope.summary.clippedSamples).toBe(0);
  for (let i = 0; i < 3; i++) await page.locator('#addPlayhead').click();
  await setRange(page, '#speed', .8); await page.locator('#traversalDirection').click(); await page.locator('#resetDemo').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click(); await waitForStableAudioState(page, false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click(); await page.locator('#audioButton').click(); await waitForStableAudioState(page, false);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
});

test('all 30 complete presets recall exactly and preserve Audio, primary Play and volume', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await open(page);
  const bank = await page.evaluate(async () => (await import('/src/instruments/blobs/presets.js')).BLOB_PRESETS);
  expect(bank).toHaveLength(30);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await setRange(page, '#level', .37);
  await page.locator('#playButton').click();
  for (const preset of bank) {
    await page.locator('.header-preset-next').click();
    const current = await capture(page);
    expect(current.selectedId, preset.label).toBe(preset.id);
    expect(current.snapshot, preset.label).toEqual(preset.snapshot);
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#level')).toHaveValue('0.37');
  }
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.header-preset-next').click();
  await page.locator('.header-preset-random').click();
  expect((await capture(page)).selectedId).toBeNull();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#level')).toHaveValue('0.37');
  await page.locator('#playButton').click();
  await page.locator('.header-preset-next').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('rotation, tempo and corners are independent and Shape envelope controls edit the saved scene', async ({ page }) => {
  await open(page);
  await page.locator('#playheadTempo').fill('30');
  await page.locator('#rotationTempo').fill('18');
  expect((await scene(page)).params.speed).toBe(.5);
  expect((await scene(page)).params.rotationSpeed).toBe(.3);
  const initialAngle = await page.locator('#rotationOut').textContent();
  await page.locator('#rotationPlayButton').click();
  await expect.poll(() => page.locator('#rotationOut').textContent()).not.toBe(initialAngle);
  await expect(page.locator('#positionOut')).toHaveText('0.0%');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#rotationPlayButton').click();
  await setRange(page, '#rotation', 67);
  await expect(page.locator('#rotationOut')).toHaveText('67°');
  await page.waitForTimeout(120);
  await expect(page.locator('#rotationOut')).toHaveText('67°');
  await page.locator('#pingPongMotion').click();
  await setRange(page, '#position', .75);
  await page.locator('#headOption0').click();
  expect((await scene(page)).params.traceHeadDirectionAdjustments[0]).toBeCloseTo(1.5);
  await expect(page.locator('#positionOut')).toHaveText('75.0%');
  await setRange(page, '#position', 1);
  await page.locator('#rotationTempo').focus();
  await expect(page.locator('#positionOut')).toHaveText('100.0%');
  await page.locator('#formSection > summary').click();
  await page.locator('#cornerMode').selectOption('even');
  await setRange(page, '#corners', 11);
  expect((await scene(page)).params).toMatchObject({ cornerMode: 'even', corners: 11 });
  await expect(page.locator('#cornersOut')).toHaveText('11');
  await page.locator('#cornerMode').selectOption('anchors');
  await expect(page.locator('#cornersControl')).toBeHidden();
  await page.locator('#soundSection > summary').click();
  await page.locator('#soundMode').selectOption('fm');
  await expect(page.locator('#fmArticulation')).toBeVisible();
  await expect(page.locator('#pmArticulation')).toBeHidden();
  await page.locator('#amplitudePresetPad').click();
  expect((await scene(page)).params.amplitudePreset).toBe('pad');
  await page.locator('#amplitudeNode2').focus(); await page.keyboard.press('ArrowUp');
  expect((await scene(page)).params.amplitudePreset).toBe('custom');
  await page.locator('#mappingSection > summary').click();
  await page.locator('#pitchCurveExponential').click();
  expect((await scene(page)).params.pitchCurvePreset).toBe('exponential');
  await page.locator('#pitchCurveNode2').focus(); await page.keyboard.press('ArrowUp');
  expect((await scene(page)).params.pitchCurvePreset).toBe('custom');
});

test('default Edit drags one transaction, Undo/Redo restore it, and cancelled gestures preserve live transport', async ({ page }) => {
  await open(page);
  const original = await scene(page), point = original.blobs[0].points[0];
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await dragPoint(page, point, 30, 18);
  const edited = await scene(page);
  expect(edited.blobs[0].points[0].x).toBeGreaterThan(point.x);
  expect(edited.blobs[0].points[0].y).toBeGreaterThan(point.y);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(original.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  expect((await scene(page)).blobs).toEqual(edited.blobs);
  for (const cancel of ['Escape', 'pointercancel']) {
    await dragPoint(page, edited.blobs[0].points[0], 35, 24, { cancel });
    expect((await scene(page)).blobs).toEqual(edited.blobs);
  }
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(original.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#stage').focus();
  await page.keyboard.press('Control+Shift+z');
  expect((await scene(page)).blobs).toEqual(edited.blobs);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});

test('double-click splits pen and closing line contours; Delete and Backspace retain three points', async ({ page }) => {
  await open(page);
  let before = (await scene(page)).blobs[0];
  const midpoint = curvePoint(before, 0, .5), pen = await position(page, midpoint.x, midpoint.y);
  await page.mouse.dblclick(pen.x, pen.y);
  expectMidpointSplitPreservesCurve(before, (await scene(page)).blobs[0], 0);
  await expect(page.locator('#pointSelection')).toHaveText('Point 2 of 6');
  await page.keyboard.press('Delete');
  expect((await scene(page)).blobs[0].points).toHaveLength(5);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Delete');
  expect((await scene(page)).blobs[0].points).toHaveLength(3);
  await expect(page.locator('#deletePoint')).toBeDisabled();
  const minimum = (await scene(page)).blobs[0];
  await page.keyboard.press('Backspace'); await page.keyboard.press('Delete');
  expect((await scene(page)).blobs[0]).toEqual(minimum);
  await page.locator('#clearAll').click(); await page.locator('[data-tool="line"]').click();
  for (const [x, y] of [[.3, .3], [.7, .3], [.7, .7], [.3, .7], [.3, .3]]) await clickPoint(page, x, y);
  await page.locator('[data-tool="edit"]').click();
  before = (await scene(page)).blobs[0];
  const last = before.points.length - 1, closing = curvePoint(before, last, .5), p = await position(page, closing.x, closing.y);
  await page.mouse.dblclick(p.x, p.y);
  expectMidpointSplitPreservesCurve(before, (await scene(page)).blobs[0], last);
  await page.locator('#undo').click(); expect((await scene(page)).blobs[0]).toEqual(before);
  await page.locator('#redo').click(); expect((await scene(page)).blobs[0].points).toHaveLength(5);
});

test('reflection axes create eight linked copies; reflected anchors and independent handles persist', async ({ page }) => {
  await open(page);
  await page.locator('[data-reflection-axis="vertical"]').click();
  await expect(page.locator('#symmetryCount')).toHaveText('2 linked copies');
  const original = await scene(page), point = original.blobs[0].points[0];
  // Drag the vertical reflection, whose rightward motion moves the source left.
  await dragPoint(page, { x: 1 - point.x, y: point.y }, 25, 18);
  let edited = await scene(page);
  expect(edited.blobs).toHaveLength(1);
  expect(edited.blobs[0].points[0].x).toBeLessThan(point.x);
  expect(edited.blobs[0].points[0].y).toBeGreaterThan(point.y);
  // Reselect the source; Alt-drag only its outgoing handle.
  const anchor = edited.blobs[0].points[0];
  await clickPoint(page, anchor.x, anchor.y);
  const handle = { x: anchor.x + anchor.hx, y: anchor.y + anchor.hy };
  await dragPoint(page, handle, 18, 20, { alt: true });
  edited = await scene(page);
  const after = edited.blobs[0].points[0];
  expect(after.hx).not.toBe(anchor.hx);
  expect(after.hy).not.toBe(anchor.hy);
  expect(after.inHx).toBeCloseTo(anchor.inHx ?? -anchor.hx);
  expect(after.inHy).toBeCloseTo(anchor.inHy ?? -anchor.hy);
  await page.locator('[data-reflection-axis="horizontal"]').click();
  await expect(page.locator('#symmetryCount')).toHaveText('4 linked copies');
  await page.locator('[data-reflection-axis="diagonal"]').click();
  await expect(page.locator('#symmetryCount')).toHaveText('8 linked copies');
  const saved = await scene(page);
  expect([...saved.params.reflectionAxes].sort()).toEqual(['vertical', 'horizontal', 'diagonal'].sort());
  expect(saved.blobs).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#symmetryCount')).toHaveText('8 linked copies');
  expect((await scene(page)).blobs).toEqual(saved.blobs);
  expect((await scene(page)).params.reflectionAxes).toEqual(saved.params.reflectionAxes);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('touch users select a segment and add an anchor with the Add point button', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await open(page);
    const before = (await scene(page)).blobs[0], midpoint = curvePoint(before, 1, .5), p = await position(page, midpoint.x, midpoint.y);
    await page.touchscreen.tap(p.x, p.y);
    await expect(page.locator('#pointSelection')).toHaveText('Point 2 of 5');
    await page.locator('#insertPoint').tap();
    expectMidpointSplitPreservesCurve(before, (await scene(page)).blobs[0], 1);
    await expect(page.locator('#pointSelection')).toHaveText('Point 3 of 6');
  } finally { await context.close(); }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`layout, control reachability and accessibility ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
    const page = await context.newPage(); await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const stage = await page.locator('#stage').boundingBox(), panel = await page.locator('.blobs-panel').boundingBox();
    if (viewport.width < 700) expect(stage.y + stage.height).toBeLessThanOrEqual(panel.y + 1);
    else expect(stage.x + stage.width).toBeLessThanOrEqual(panel.x + 1);
    expect(stage.y + stage.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.locator('#mappingSection > summary').click();
    for (const selector of ['#playButton', '#audioButton', '#clearAll', '#insertPoint', '[data-reflection-axis="diagonal"]', '#stereoWidth', '#resetDemo']) {
      // Center controls beneath the sticky preset strip before hit-testing.
      await page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      const box = await page.locator(selector).boundingBox(); expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return hit === el || el.contains(hit); }), `${selector} is reachable`).toBe(true);
      if (viewport.width < 1000 && ['#playButton', '#audioButton'].includes(selector)) { expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48); }
    }
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact))).toEqual([]);
    await context.close();
  });
}
