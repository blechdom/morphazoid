import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

const STORAGE_KEY = 'morphazoid:blobs:v5';
const scene = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const sentPaths = page => page.evaluate(() => window.__blobsLastAudioScene?.paths ?? []);

async function open(page) {
  await page.addInitScript(() => {
    const NativeNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context, name, options) {
        super(context, name, options);
        if (name !== 'blobs') return;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...rest) => {
          if (message?.type === 'scene') window.__blobsLastAudioScene = structuredClone(message);
          return post(message, ...rest);
        };
      }
    };
  });
  await page.goto('/blobs.html');
  await expect(page.locator('#selectedBlob option')).toHaveCount(1);
  await page.locator('#amplitudeEnvelopeToggle').evaluate(button => button.click());
  await page.locator('#clearAll').click();
}

async function stagePoint(page, x, y) {
  const box = await page.locator('#stage').boundingBox();
  const size = Math.max(1, Math.min(box.width - 32, box.height - 92));
  return { x: box.x + (box.width - size) / 2 + x * size, y: box.y + 58 + (box.height - 92 - size) / 2 + y * size };
}

async function addPoint(page, x, y, handle = null) {
  const point = await stagePoint(page, x, y);
  if (!handle) return page.mouse.click(point.x, point.y);
  const end = await stagePoint(page, x + handle.x, y + handle.y);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
}

async function doubleClickPoint(page, x, y) {
  const point = await stagePoint(page, x, y);
  await page.mouse.dblclick(point.x, point.y);
}

async function expectSound(page) {
  await waitForStableAudioState(page, true);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
  expect(summary.finite).toBe(true);
  expect(summary.clippedSamples).toBe(0);
  expect(summary.maxPeak).toBeGreaterThan(.001);
}

for (const tool of ['line', 'pen']) {
  test(`${tool}: two points audition immediately and Finish saves an open path without changing its sound geometry`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page);
    await page.locator('#playButton').click(); await page.locator('#audioButton').click();
    await page.locator(`[data-tool="${tool}"]`).click();
    await addPoint(page, .25, .3, tool === 'pen' ? { x: .12, y: -.06 } : null);
    await expect(page.locator('#finishPath')).toBeDisabled();
    await addPoint(page, .75, .7, tool === 'pen' ? { x: .06, y: -.1 } : null);
    expect((await scene(page)).blobs).toEqual([]);
    await expectSound(page);
    const preview = await sentPaths(page);
    expect(preview).toHaveLength(1);
    expect(preview[0].closed).toBe(false);
    expect(preview[0].points[0].x).toBeCloseTo(-.5, 2);
    expect(preview[0].points[0].y).toBeCloseTo(-.4, 2);
    expect(preview[0].points.at(-1).x).toBeCloseTo(.5, 2);
    expect(preview[0].points.at(-1).y).toBeCloseTo(.4, 2);
    await expect(page.locator('#finishPath')).toHaveText('Finish path');
    await page.locator('#finishPath').click();
    const saved = await scene(page);
    expect(saved.version).toBe(5);
    expect(saved.blobs).toHaveLength(1);
    expect(saved.blobs[0].closed).toBe(false);
    expect(saved.blobs[0].points).toHaveLength(2);
    const committed = await sentPaths(page);
    expect(committed[0].closed).toBe(false);
    expect(committed[0].points).toEqual(preview[0].points);
    expect(committed[0].totalLength).toBe(preview[0].totalLength);
    expect(committed[0].pathKey).toBe(preview[0].pathKey);
    await expectSound(page);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#undo').click();
    expect((await scene(page)).blobs).toEqual([]);
    expect(await sentPaths(page)).toEqual([]);
    await page.locator('#redo').click();
    expect((await scene(page)).blobs).toEqual(saved.blobs);
    await expectSound(page);
    await page.reload();
    await expect(page.locator('#selectedBlob option')).toHaveCount(1);
    expect((await scene(page)).blobs).toEqual(saved.blobs);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(errors).toEqual([]);
  });
}

test('only selecting the first anchor closes a Line draft, including its reflected first anchor', async ({ page }) => {
  await open(page);
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  await page.locator('[data-reflection-axis="vertical"]').click();
  await page.locator('[data-tool="line"]').click();
  await addPoint(page, .2, .3); await addPoint(page, .4, .3); await addPoint(page, .4, .7);
  const preview = await sentPaths(page);
  expect(preview).toHaveLength(2);
  expect(preview.every(path => path.closed === false)).toBe(true);
  // Return to the visible first anchor of the mirrored copy, not an implicit seam.
  await addPoint(page, .8, .3);
  const saved = await scene(page);
  expect(saved.blobs).toHaveLength(1);
  expect(saved.blobs[0].closed).toBe(true);
  expect(saved.blobs[0].points).toHaveLength(3);
  expect(saved.blobs[0].points[0].x).toBeCloseTo(.2, 3);
  const paths = await sentPaths(page);
  expect(paths).toHaveLength(2);
  expect(paths.every(path => path.closed === true)).toBe(true);
  expect(paths[0].totalLength).toBeGreaterThan(preview[0].totalLength);
  await expectSound(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
});

test('open Line editing ignores the absent closing edge and permits deleting down to two anchors', async ({ page }) => {
  await open(page);
  await page.locator('#audioButton').click();
  await page.locator('[data-tool="line"]').click();
  await addPoint(page, .25, .3); await addPoint(page, .75, .3); await addPoint(page, .75, .7);
  await page.locator('#finishPath').click();
  await page.locator('[data-tool="edit"]').click();
  const original = (await scene(page)).blobs[0];
  const [path] = await sentPaths(page);
  expect(path.closed).toBe(false);
  // Every sound sample lies on the drawn L; no shortcut joins the two ends.
  expect(path.points.every(point => Math.abs(point.y + .4) < .008 || Math.abs(point.x - .5) < .008)).toBe(true);
  expect(path.totalLength).toBeCloseTo(1.8, 2);
  await doubleClickPoint(page, .5, .5);
  expect((await scene(page)).blobs[0]).toEqual(original);
  await doubleClickPoint(page, .5, .3);
  const inserted = (await scene(page)).blobs[0];
  expect(inserted.points).toHaveLength(4);
  expect(inserted.closed).toBe(false);
  await doubleClickPoint(page, .5, .3);
  expect((await scene(page)).blobs[0]).toEqual(original);
  await doubleClickPoint(page, .75, .3);
  const two = (await scene(page)).blobs[0];
  expect(two.points).toHaveLength(2);
  expect(two.closed).toBe(false);
  await doubleClickPoint(page, .25, .3);
  expect((await scene(page)).blobs[0]).toEqual(two);
  await expect(page.locator('#deletePoint')).toBeDisabled();
  await page.locator('#undo').click();
  expect((await scene(page)).blobs[0]).toEqual(original);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('Pencil release remains open unless its final point returns to the start', async ({ page }) => {
  await open(page);
  const stroke = async close => {
    await page.locator('[data-tool="pencil"]').click();
    const points = [[.25, .3], [.7, .3], [.75, .65], [.3, .7], ...(close ? [[.25, .3]] : [])];
    const first = await stagePoint(page, ...points[0]);
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    for (const point of points.slice(1)) {
      const next = await stagePoint(page, ...point);
      await page.mouse.move(next.x, next.y, { steps: 8 });
    }
    await page.mouse.up();
  };
  await stroke(false);
  const openBlob = (await scene(page)).blobs[0];
  expect(openBlob.closed).toBe(false);
  expect(openBlob.points[0].x).toBeCloseTo(.25, 3);
  expect(openBlob.points.at(-1).x).toBeCloseTo(.3, 3);
  expect(openBlob.points.at(-1).y).toBeCloseTo(.7, 3);
  await stroke(true);
  const saved = await scene(page);
  expect(saved.blobs).toHaveLength(2);
  expect(saved.blobs[0]).toEqual(openBlob);
  expect(saved.blobs[1].closed).toBe(true);
  expect(saved.blobs[1].points[0]).not.toEqual(saved.blobs[1].points.at(-1));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('keyboard F finishes open and Enter on the first point closes, without enabling transport', async ({ page }) => {
  await open(page);
  await page.locator('[data-tool="line"]').click();
  const canvas = page.locator('#stage'); await canvas.focus();
  await canvas.press('Enter');
  for (let i = 0; i < 5; i++) await canvas.press('Shift+ArrowRight');
  await canvas.press('Enter');
  await canvas.press('c');
  expect((await scene(page)).blobs).toEqual([]);
  await canvas.press('f');
  expect((await scene(page)).blobs).toHaveLength(1);
  expect((await scene(page)).blobs[0].closed).toBe(false);
  await page.locator('#clearAll').click(); await page.locator('[data-tool="line"]').click();
  await canvas.focus(); await canvas.press('Enter');
  for (let i = 0; i < 5; i++) await canvas.press('Shift+ArrowLeft');
  await canvas.press('Enter');
  for (let i = 0; i < 5; i++) await canvas.press('Shift+ArrowDown');
  await canvas.press('Enter');
  for (let i = 0; i < 5; i++) await canvas.press('Shift+ArrowRight');
  for (let i = 0; i < 5; i++) await canvas.press('Shift+ArrowUp');
  await canvas.press('Enter');
  const saved = await scene(page);
  expect(saved.blobs).toHaveLength(1);
  expect(saved.blobs[0].closed).toBe(true);
  expect(saved.blobs[0].points).toHaveLength(3);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('legacy v4 loops migrate as closed while an added open path survives reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('morphazoid:blobs:v5')) return;
    localStorage.setItem('morphazoid:blobs:v4', JSON.stringify({ version: 4, params: {}, blobs: [{ tool: 'line', points: [
      { x: .25, y: .3 }, { x: .75, y: .3 }, { x: .5, y: .7 },
    ] }] }));
  });
  await page.goto('/blobs.html');
  await expect(page.locator('#selectedBlob option')).toHaveCount(1);
  const migrated = await scene(page);
  expect(migrated.version).toBe(5);
  expect(await page.evaluate(async key => {
    const { buildPerformancePath } = await import('/src/instruments/blobs/paths.js');
    const current = JSON.parse(localStorage.getItem(key));
    return buildPerformancePath(current.blobs[0], current.params).closed;
  }, STORAGE_KEY)).toBe(true);
  await page.locator('[data-tool="line"]').click();
  await addPoint(page, .3, .4); await addPoint(page, .65, .6);
  await page.locator('#finishPath').click();
  const saved = await scene(page);
  expect(saved.blobs.map(blob => blob.closed !== false)).toEqual([true, false]);
  await page.reload();
  await expect(page.locator('#selectedBlob option')).toHaveCount(2);
  expect((await scene(page)).blobs).toEqual(saved.blobs);
});

test('touch can save a two-point path on a phone without a closure setting', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await open(page);
    await page.locator('[data-tool="line"]').tap();
    for (const point of [[.25, .3], [.75, .65]]) {
      const position = await stagePoint(page, ...point);
      await page.touchscreen.tap(position.x, position.y);
    }
    await page.locator('#finishPath').tap();
    const saved = await scene(page);
    expect(saved.blobs).toHaveLength(1);
    expect(saved.blobs[0].closed).toBe(false);
    expect(saved.blobs[0].points).toHaveLength(2);
    await expect(page.getByRole('button', { name: /^(open|closed)$/i })).toHaveCount(0);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  } finally { await context.close(); }
});
