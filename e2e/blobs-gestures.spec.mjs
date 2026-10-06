import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const STORAGE_KEY = 'morphazoid:blobs:v4';
const rectangle = (x, y, radius = .1) => ({ tool: 'line', points: [
  { x: x - radius, y: y - radius, hx: 0, hy: 0 },
  { x: x + radius, y: y - radius, hx: 0, hy: 0 },
  { x: x + radius, y: y + radius, hx: 0, hy: 0 },
  { x: x - radius, y: y + radius, hx: 0, hy: 0 },
] });
const scene = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const offset = blob => blob.offset ?? { x: 0, y: 0 };
const angle = async page => Number(await page.locator('#rotation').inputValue());
const angleDelta = (after, before) => ((after - before + 540) % 360) - 180;
const rendererErrors = new Map();

test.beforeEach(async ({ page }, testInfo) => {
  const errors = [];
  rendererErrors.set(testInfo.testId, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({}, testInfo) => {
  const errors = rendererErrors.get(testInfo.testId);
  rendererErrors.delete(testInfo.testId);
  expect(errors, 'The drawing renderer must not throw browser errors').toEqual([]);
});

async function expectRendered(page, point = null) {
  await expect.poll(() => page.locator('#stage').evaluate((canvas, point) => {
    const box = canvas.getBoundingClientRect(), size = Math.max(1, Math.min(box.width - 32, box.height - 92));
    const scaleX = canvas.width / box.width, scaleY = canvas.height / box.height;
    const x = point ? Math.round(((box.width - size) / 2 + point.x * size) * scaleX) : 0;
    const y = point ? Math.round((58 + (box.height - 92 - size) / 2 + point.y * size) * scaleY) : 0;
    const pixels = point
      ? canvas.getContext('2d').getImageData(x - 6, y - 6, 13, 13).data
      : canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let cyan = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      // Count the first blob's opaque turquoise contour, excluding the grid,
      // translucent fill, orange corners, violet guides and white playheads.
      if (pixels[i + 3] > 96 && pixels[i + 1] > 150 && pixels[i + 2] > 120 && pixels[i + 1] > pixels[i] * 1.4) cyan++;
    }
    return cyan;
  }, point), { message: point ? 'The moved contour must render at its new position' : 'The canvas must contain the visible blob contour' }).toBeGreaterThan(point ? 3 : 40);
}

async function open(page, blobs = [rectangle(.25, .35), rectangle(.70, .65)], params = {}) {
  await page.addInitScript(({ key, blobs, params }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 4, blobs, params }));
  }, { key: STORAGE_KEY, blobs, params });
  await page.goto('/blobs.html');
  await expect(page.locator('#selectedBlob option')).toHaveCount(blobs.length);
  await expect(page.locator('[data-tool="edit"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#undo')).toBeDisabled();
  await expectRendered(page);
}

async function position(page, point) {
  const box = await page.locator('#stage').boundingBox();
  const size = Math.max(1, Math.min(box.width - 32, box.height - 92));
  return {
    x: box.x + (box.width - size) / 2 + point.x * size,
    y: box.y + 58 + (box.height - 92 - size) / 2 + point.y * size,
    size,
  };
}

async function drag(page, from, to, { cancel = null } = {}) {
  const start = await position(page, from), end = await position(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  if (cancel === 'Escape') await page.keyboard.press('Escape');
  if (cancel === 'pointercancel') await page.locator('#stage').dispatchEvent('pointercancel');
  await page.mouse.up();
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('interior hand cursor moves one complete blob rigidly in one undo transaction', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 1180, height: 800 });
  await expectRendered(page);
  const before = await scene(page), center = await position(page, { x: .25, y: .35 });
  await page.mouse.move(center.x, center.y);
  await expect(page.locator('#stage')).toHaveCSS('cursor', 'grab');
  await page.mouse.click(center.x, center.y);
  await expect(page.locator('#undo')).toBeDisabled();
  const outside = await position(page, { x: .94, y: .5 });
  await page.mouse.click(outside.x, outside.y);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await expect(page.locator('#stage')).toHaveCSS('cursor', 'grabbing');
  const end = await position(page, { x: .33, y: .40 });
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  const after = await scene(page);
  expect(offset(after.blobs[0]).x).toBeCloseTo(.08, 4);
  expect(offset(after.blobs[0]).y).toBeCloseTo(.05, 4);
  expect(after.blobs[0].points).toEqual(before.blobs[0].points);
  expect(after.blobs[1]).toEqual(before.blobs[1]);
  await expectRendered(page, { x: .43, y: .40 });
  await expect(page.locator('#stage')).toHaveCSS('cursor', 'grab');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(before.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  expect((await scene(page)).blobs).toEqual(after.blobs);
  await page.reload();
  expect((await scene(page)).blobs).toEqual(after.blobs);
  await expectRendered(page, { x: .43, y: .40 });
});

test('body translation clamps as a rigid whole and can be undone after captured off-canvas motion', async ({ page }) => {
  await open(page, [rectangle(.5, .5)]);
  const before = await scene(page);
  await drag(page, { x: .5, y: .5 }, { x: 1.8, y: .5 });
  const after = await scene(page);
  expect(offset(after.blobs[0]).x).toBeCloseTo(.4, 3);
  expect(offset(after.blobs[0]).y).toBeCloseTo(0, 4);
  expect(after.blobs[0].points).toEqual(before.blobs[0].points);
  // The body remains available at the canvas edge, so the next drag recovers it.
  await drag(page, { x: .9, y: .5 }, { x: .6, y: .5 });
  expect(offset((await scene(page)).blobs[0]).x).toBeCloseTo(.1, 3);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(after.blobs);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(before.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('dragging a reflected interior uses the inverse reflection and preserves authored curves', async ({ page }) => {
  const blob = { tool: 'pen', points: [
    { x: .18, y: .22, hx: .07, hy: -.025, inHx: -.04, inHy: .03 },
    { x: .36, y: .25, hx: .03, hy: .065, inHx: -.08, inHy: -.02 },
    { x: .33, y: .45, hx: -.065, hy: .035, inHx: .015, inHy: -.075 },
    { x: .15, y: .40, hx: -.015, hy: -.06, inHx: .075, inHy: .02 },
  ] };
  await open(page, [blob], { reflectionAxes: ['vertical'] });
  await expect(page.locator('#symmetryCount')).toHaveText('2 linked copies');
  const before = await scene(page), copy = await position(page, { x: .75, y: .34 });
  await page.mouse.move(copy.x, copy.y);
  await expect(page.locator('#stage')).toHaveCSS('cursor', 'grab');
  await drag(page, { x: .75, y: .34 }, { x: .81, y: .38 });
  const after = await scene(page);
  expect(offset(after.blobs[0]).x).toBeCloseTo(-.06, 4);
  expect(offset(after.blobs[0]).y).toBeCloseTo(.04, 4);
  expect(after.blobs[0].points).toEqual(before.blobs[0].points);
  expect(after.params.reflectionAxes).toEqual(['vertical']);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(before.blobs);
});

test('background dragging rotates all blobs together; click, undo and cancellation preserve the angle', async ({ page }) => {
  await open(page);
  const before = await scene(page), outside = await position(page, { x: .94, y: .5 });
  await page.mouse.click(outside.x, outside.y);
  expect(await angle(page)).toBeCloseTo(0, 4);
  await expect(page.locator('#undo')).toBeDisabled();
  await drag(page, { x: .94, y: .5 }, { x: .5, y: .94 });
  await expect.poll(() => angle(page)).toBeCloseTo(90, 1);
  expect((await scene(page)).blobs).toEqual(before.blobs);
  await expectRendered(page, { x: .75, y: .25 });
  // Both body hit regions orbit the same canvas center, including their separation.
  for (const center of [{ x: .65, y: .25 }, { x: .35, y: .70 }]) {
    const p = await position(page, center);
    await page.mouse.move(p.x, p.y);
    await expect(page.locator('#stage')).toHaveCSS('cursor', 'grab');
  }
  await page.locator('#undo').click();
  await expect.poll(() => angle(page)).toBeCloseTo(0, 1);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  await expect.poll(() => angle(page)).toBeCloseTo(90, 1);
  for (const cancel of ['Escape', 'pointercancel']) {
    await drag(page, { x: .06, y: .5 }, { x: .5, y: .06 }, { cancel });
    await expect.poll(() => angle(page)).toBeCloseTo(90, 1);
    expect((await scene(page)).blobs).toEqual(before.blobs);
  }
  await page.locator('#undo').click();
  await expect.poll(() => angle(page)).toBeCloseTo(0, 1);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('empty space within a concave outline bounding box rotates rather than moving the blob', async ({ page }) => {
  const concave = { tool: 'line', points: [[.2, .2], [.7, .2], [.7, .4], [.4, .4], [.4, .7], [.2, .7]].map(([x, y]) => ({ x, y, hx: 0, hy: 0 })) };
  await open(page, [concave]);
  const before = await scene(page);
  // This point is in the L's empty notch, well clear of its edges and anchors.
  await drag(page, { x: .60, y: .60 }, { x: .40, y: .60 });
  await expect.poll(() => angle(page)).toBeCloseTo(90, 1);
  expect((await scene(page)).blobs).toEqual(before.blobs);
});

test('keyboard body movement and common rotation preserve point editing and undo independently', async ({ page }) => {
  await open(page, [rectangle(.5, .5)]);
  const before = await scene(page);
  await page.locator('#stage').focus();
  await page.keyboard.press('Alt+ArrowRight');
  expect(offset((await scene(page)).blobs[0]).x).toBeCloseTo(.01, 4);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  expect(offset((await scene(page)).blobs[0]).y).toBeCloseTo(.04, 4);
  expect((await scene(page)).blobs[0].points).toEqual(before.blobs[0].points);
  await page.keyboard.press('BracketRight');
  await expect.poll(() => angle(page)).toBeCloseTo(15, 1);
  await page.keyboard.press('Shift+BracketLeft');
  await expect.poll(() => angle(page)).toBeCloseTo(-30, 1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => angle(page)).toBeCloseTo(15, 1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => angle(page)).toBeCloseTo(0, 1);
  await page.keyboard.press('Control+z');
  expect(offset((await scene(page)).blobs[0]).y).toBeCloseTo(0, 4);
  await page.keyboard.press('Control+z');
  expect((await scene(page)).blobs).toEqual(before.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  expect((await scene(page)).blobs[0].points[0].x).toBeGreaterThan(before.blobs[0].points[0].x);
  expect(offset((await scene(page)).blobs[0])).toEqual(offset(before.blobs[0]));
});

for (const rotationMotionMode of ['loop', 'pingpong']) test(`body and rotation gestures preserve live Audio, Play and ${rotationMotionMode} rotation including cancelled moves`, async ({ page }) => {
  await open(page, [rectangle(.5, .5)], { rotationMotionMode });
  await setRange(page, '#rotationSpeed', .02);
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await page.locator('#rotationPlayButton').click();
  const original = await scene(page);
  await drag(page, { x: .5, y: .5 }, { x: .54, y: .53 });
  const translated = await scene(page);
  expect(Math.hypot(offset(translated.blobs[0]).x, offset(translated.blobs[0]).y)).toBeGreaterThan(.03);
  expect(translated.blobs[0].points).toEqual(original.blobs[0].points);
  const rotationBefore = await angle(page);
  await drag(page, { x: .94, y: .5 }, { x: .5, y: .94 });
  const rotationAfter = await angle(page);
  expect(angleDelta(rotationAfter, rotationBefore)).toBeGreaterThan(80);
  expect(angleDelta(rotationAfter, rotationBefore)).toBeLessThan(110);
  await page.locator('#undo').click();
  expect(Math.abs(angleDelta(await angle(page), rotationBefore))).toBeLessThan(20);
  for (const cancel of ['Escape', 'pointercancel']) {
    const startAngle = await angle(page);
    await drag(page, { x: .94, y: .5 }, { x: .5, y: .94 }, { cancel });
    expect(Math.abs(angleDelta(await angle(page), startAngle))).toBeLessThan(20);
    expect((await scene(page)).blobs).toEqual(translated.blobs);
  }
  for (const selector of ['#playButton', '#audioButton', '#rotationPlayButton']) await expect(page.locator(selector)).toHaveAttribute('aria-pressed', 'true');
  const previousAngle = await angle(page), previousPosition = await page.locator('#positionOut').textContent();
  await expect.poll(() => angle(page)).not.toBe(previousAngle);
  await expect.poll(() => page.locator('#positionOut').textContent()).not.toBe(previousPosition);
  const envelope = await sampleAudioEnvelope(page);
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(original.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('touch interior drags translate the body and touch cancellation restores the previous gesture', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), client = await context.newCDPSession(page);
  page.on('pageerror', error => rendererErrors.get(testInfo.testId)?.push(error.message));
  const touch = (type, p) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 3, radiusY: 3, force: .5 }] : [],
  });
  try {
    await open(page, [rectangle(.5, .5)]);
    const before = await scene(page), start = await position(page, { x: .5, y: .5 });
    const end = { x: start.x + 22, y: start.y + 13 };
    await touch('touchStart', start); await touch('touchMove', end); await touch('touchEnd');
    const after = await scene(page);
    expect(offset(after.blobs[0]).x).toBeCloseTo(22 / start.size, 3);
    expect(offset(after.blobs[0]).y).toBeCloseTo(13 / start.size, 3);
    expect(after.blobs[0].points).toEqual(before.blobs[0].points);
    await touch('touchStart', end);
    await touch('touchMove', { x: end.x + 25, y: end.y + 15 });
    await touch('touchCancel');
    expect((await scene(page)).blobs).toEqual(after.blobs);
    await page.locator('#undo').tap();
    expect((await scene(page)).blobs).toEqual(before.blobs);
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  } finally { await context.close(); }
});

test('overlapping fills move only the last drawn blob when their interiors are grabbed', async ({ page }) => {
  await open(page, [rectangle(.5, .5, .2), rectangle(.5, .5, .12)]);
  const before = await scene(page), center = await position(page, { x: .5, y: .5 });
  await page.mouse.move(center.x, center.y);
  await expect(page.locator('#stage')).toHaveCSS('cursor', 'grab');
  await drag(page, { x: .5, y: .5 }, { x: .56, y: .54 });
  const after = await scene(page);
  expect(after.blobs[0]).toEqual(before.blobs[0]);
  expect(after.blobs[1].points).toEqual(before.blobs[1].points);
  expect(offset(after.blobs[1]).x).toBeCloseTo(.06, 4);
  expect(offset(after.blobs[1]).y).toBeCloseTo(.04, 4);
  await expect(page.locator('#selectedBlob')).toHaveValue('1');
  await page.locator('#undo').click();
  expect((await scene(page)).blobs).toEqual(before.blobs);
  await expect(page.locator('#undo')).toBeDisabled();
});

test('stored v3 drawings migrate to v4 without changing points or musical parameters or starting playback', async ({ page }) => {
  await page.goto('/blobs.html');
  await expect(page.locator('#selectedBlob option')).toHaveCount(1);
  const legacy = await scene(page);
  legacy.version = 3;
  legacy.blobs = [{ tool: 'pen', points: [
    { x: .18, y: .22, hx: .07, hy: -.025, inHx: -.04, inHy: .03 },
    { x: .36, y: .25, hx: .03, hy: .065, inHx: -.08, inHy: -.02 },
    { x: .33, y: .45, hx: -.065, hy: .035, inHx: .015, inHy: -.075 },
    { x: .15, y: .40, hx: -.015, hy: -.06, inHx: .075, inHy: .02 },
  ] }, rectangle(.72, .65)];
  Object.assign(legacy.params, { speed: .65, rotationSpeed: .35, soundMode: 'fm', fmIndex: 4, stereoWidth: .73, reflectionAxes: ['vertical'] });
  // A real previous session may leave Audio and transport running before navigation.
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(({ key, legacy }) => {
    localStorage.setItem('morphazoid:blobs:v3', JSON.stringify(legacy));
    localStorage.removeItem(key);
  }, { key: STORAGE_KEY, legacy });
  // Navigation runs the old document's save handler; remove its v4 entry before
  // the new instrument module reads storage so the legacy fallback is exercised.
  await page.addInitScript(key => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#selectedBlob option')).toHaveCount(2);
  await expectRendered(page);
  const migrated = await scene(page);
  expect(migrated.version).toBe(4);
  expect(migrated.blobs).toEqual(legacy.blobs);
  expect(migrated.params).toEqual(legacy.params);
  await expect(page.locator('#symmetryCount')).toHaveText('2 linked copies');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#rotationPlayButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#positionOut')).toHaveText('0.0%');
  await expect(page.locator('#undo')).toBeDisabled();
});
