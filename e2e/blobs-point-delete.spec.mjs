import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const STORAGE_KEY = 'morphazoid:blobs:v5';
const scene = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

async function open(page, blob, params = {}) {
  await page.addInitScript(({ key, blob, params }) => {
    localStorage.setItem(key, JSON.stringify({ version: 4, blobs: [blob], params }));
  }, { key: STORAGE_KEY, blob, params });
  await page.goto('/blobs.html');
  await expect(page.locator('#selectedBlob option')).toHaveCount(1);
  await expect(page.locator('[data-tool="edit"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#undo')).toBeDisabled();
}

async function doubleClickPoint(page, point) {
  const box = await page.locator('#stage').boundingBox();
  const size = Math.max(1, Math.min(box.width - 32, box.height - 92));
  await page.mouse.dblclick(
    box.x + (box.width - size) / 2 + point.x * size,
    box.y + 58 + (box.height - 92 - size) / 2 + point.y * size,
  );
}

async function expectClosedPaths(page, copies = 1) {
  const paths = await page.evaluate(async key => {
    const { buildPerformancePath } = await import('/src/instruments/blobs/paths.js');
    const { expandPaths } = await import('/src/instruments/blobs/symmetry.js');
    const current = JSON.parse(localStorage.getItem(key));
    return expandPaths(current.blobs.map(blob => buildPerformancePath(blob, current.params)), current.params.reflectionAxes)
      .map(path => ({ closed: path.closed, length: path.totalLength, finite: path.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)) }));
  }, STORAGE_KEY);
  expect(paths).toHaveLength(copies);
  for (const path of paths) {
    expect(path.closed).toBe(true);
    expect(path.finite).toBe(true);
    expect(path.length).toBeGreaterThan(.06);
  }
}

test('double-click deletes pen anchors as undoable edits, keeps three points, and preserves live sound', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page, { tool: 'pen', points: [
    { x: .3, y: .25, hx: .08, hy: -.035 },
    { x: .65, y: .25, hx: .07, hy: .03 },
    { x: .78, y: .55, hx: -.015, hy: .08 },
    { x: .5, y: .78, hx: -.08, hy: 0 },
    { x: .25, y: .6, hx: -.035, hy: -.08 },
  ] });
  const before = (await scene(page)).blobs[0];
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await doubleClickPoint(page, before.points[1]);
  const deleted = (await scene(page)).blobs[0];
  expect(deleted.points).toEqual(before.points.filter((_, index) => index !== 1));
  await expectClosedPaths(page);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs[0]).toEqual(before);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#redo').click();
  expect((await scene(page)).blobs[0]).toEqual(deleted);

  await doubleClickPoint(page, deleted.points[2]);
  const triangle = (await scene(page)).blobs[0];
  expect(triangle.points).toHaveLength(3);
  await expectClosedPaths(page);
  await doubleClickPoint(page, triangle.points[0]);
  expect((await scene(page)).blobs[0]).toEqual(triangle);
  await expect(page.locator('#deletePoint')).toBeDisabled();
  // A rejected deletion must not insert a point on the adjacent edge or add undo history.
  await page.locator('#undo').click();
  expect((await scene(page)).blobs[0]).toEqual(deleted);
  await page.locator('#redo').click();
  expect((await scene(page)).blobs[0]).toEqual(triangle);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  const envelope = await sampleAudioEnvelope(page);
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(errors).toEqual([]);
});

test('double-click edits the source through a reflection and still inserts points on the closing edge', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page, { tool: 'line', points: [
    { x: .18, y: .3, hx: 0, hy: 0 },
    { x: .38, y: .3, hx: 0, hy: 0 },
    { x: .38, y: .7, hx: 0, hy: 0 },
    { x: .18, y: .7, hx: 0, hy: 0 },
  ] }, { reflectionAxes: ['vertical'] });
  await expect(page.locator('#symmetryCount')).toHaveText('2 linked copies');
  const before = (await scene(page)).blobs[0];
  await doubleClickPoint(page, { x: 1 - before.points[1].x, y: before.points[1].y });
  expect((await scene(page)).blobs).toHaveLength(1);
  expect((await scene(page)).blobs[0].points).toEqual(before.points.filter((_, index) => index !== 1));
  await expectClosedPaths(page, 2);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs[0]).toEqual(before);
  await expect(page.locator('#undo')).toBeDisabled();

  // This is the reflected closing edge's midpoint, well clear of both anchors.
  await doubleClickPoint(page, { x: .82, y: .5 });
  const inserted = (await scene(page)).blobs[0];
  expect(inserted.points).toHaveLength(5);
  expect(inserted.points.slice(0, 4)).toEqual(before.points);
  expect(inserted.points[4].x).toBeCloseTo(.18, 4);
  expect(inserted.points[4].y).toBeCloseTo(.5, 4);
  await expectClosedPaths(page, 2);
  await doubleClickPoint(page, { x: 1 - inserted.points[4].x, y: inserted.points[4].y });
  expect((await scene(page)).blobs[0]).toEqual(before);
  await page.locator('#undo').click();
  expect((await scene(page)).blobs[0]).toEqual(inserted);
  await page.locator('#redo').click();
  expect((await scene(page)).blobs[0]).toEqual(before);
  await expect(page.locator('#symmetryCount')).toHaveText('2 linked copies');
  expect(errors).toEqual([]);
});
