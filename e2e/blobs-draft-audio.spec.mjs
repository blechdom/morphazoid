import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';

const storedScene = page => page.evaluate(() => JSON.parse(localStorage.getItem('morphazoid:blobs:v4')));
const sentPaths = page => page.evaluate(() => window.__blobsLastAudioScene?.paths);

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
  // A continuous envelope makes an unexpected interruption distinguishable
  // from the intentional rests in the default corner envelope.
  await page.locator('#amplitudeEnvelopeToggle').evaluate(button => button.click());
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

async function drawTriangle(page, tool = 'line') {
  await page.locator(`[data-tool="${tool}"]`).click();
  await addPoint(page, .2, .25, tool === 'pen' ? { x: .08, y: -.05 } : null);
  await addPoint(page, .8, .3);
  await addPoint(page, .5, .8);
}

async function expectSound(page) {
  await waitForStableAudioState(page, true);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
  expect(summary.finite).toBe(true);
  expect(summary.clippedSamples).toBe(0);
  expect(summary.maxPeak).toBeGreaterThan(.001);
  return summary;
}

async function expectSilence(page) {
  await waitForStableAudioState(page, false);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 40 });
  expect(summary.maxPeak).toBeLessThan(.0001);
}

test('cleared Lines audition a closed draft and commit without replacing its sounding contour', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  await expectSound(page);
  await page.locator('[data-reflection-axis="vertical"]').click();
  await page.locator('#aspect').evaluate(input => { input.value = '.3'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#clearAll').click(); await expectSilence(page);
  await page.locator('[data-tool="line"]').click();
  await addPoint(page, .2, .25); await addPoint(page, .8, .3);
  await expectSilence(page);
  await addPoint(page, .5, .8);
  expect((await storedScene(page)).blobs).toEqual([]);
  await expectSound(page);
  await expect(page.locator('#stageReadout')).toContainText('LOOP PREVIEW');
  await expect.poll(() => page.locator('#stage').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let white = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 220 && pixels[i + 1] > 235 && pixels[i + 2] > 230) white++;
    return white;
  })).toBeGreaterThan(8); // The dashed preview must show its audible playheads.
  const preview = await sentPaths(page);
  expect(preview).toHaveLength(2); expect(preview.every(path => path.closed)).toBe(true);
  // The visible first anchor must close even after form controls and reflection.
  const first = preview.at(-1).points[0];
  await addPoint(page, (first.x + 1) / 2, (first.y + 1) / 2);
  const committed = await storedScene(page);
  expect(committed.blobs).toHaveLength(1);
  expect(committed.blobs[0].tool).toBe('line');
  expect(committed.blobs[0].points).toHaveLength(3);
  const paths = await sentPaths(page);
  expect(paths).toHaveLength(2);
  for (let i = 0; i < paths.length; i++) {
    expect(paths[i].points).toEqual(preview[i].points);
    expect(paths[i].totalLength).toBe(preview[i].totalLength);
    expect(paths[i].pathKey).toBe(preview[i].pathKey);
  }
  const sound = await expectSound(page);
  expect(sound.activeSamples).toBe(sound.sampleCount);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('cancel and tool changes release uncommitted Pen and Line previews', async ({ page }) => {
  await open(page);
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  await page.locator('#clearAll').click();
  await drawTriangle(page, 'pen');
  expect((await storedScene(page)).blobs).toEqual([]);
  await expectSound(page);
  await page.locator('#cancelPath').click(); await expectSilence(page);
  expect(await sentPaths(page)).toEqual([]);
  await drawTriangle(page);
  await expectSound(page);
  await page.locator('[data-tool="edit"]').click(); await expectSilence(page);
  expect(await sentPaths(page)).toEqual([]);
  expect((await storedScene(page)).blobs).toEqual([]);
  await expect(page.locator('#closePath')).toBeDisabled();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
});

test('draft drawing neither enables Audio nor resumes a paused primary playhead', async ({ page }) => {
  await open(page); await page.locator('#clearAll').click(); await drawTriangle(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#playButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expectSilence(page);
  await page.locator('#audioButton').click(); await expectSound(page);
  await page.locator('#playButton').click(); await expectSilence(page);
  await addPoint(page, .25, .65);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expectSilence(page);
  await page.locator('#closePath').click();
  expect((await storedScene(page)).blobs[0].points).toHaveLength(4);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await expectSilence(page);
});

test('Clear during a captured Edit drag stays empty and undo restores the original blob', async ({ page }) => {
  await open(page);
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  await expectSound(page);
  const before = await storedScene(page);
  const center = await stagePoint(page, .5, .5);
  await page.mouse.move(center.x, center.y); await page.mouse.down();
  await page.mouse.move(center.x + 30, center.y + 15, { steps: 5 });
  expect(await page.locator('#stage').evaluate(canvas => canvas.hasPointerCapture(1))).toBe(true);
  // A second pointer or keyboard activation can clear while the mouse owns
  // capture. The cancelled gesture must not restore its snapshot after Clear.
  await page.locator('#clearAll').evaluate(button => button.click());
  await page.mouse.up();
  expect((await storedScene(page)).blobs).toEqual([]);
  expect(await sentPaths(page)).toEqual([]);
  await expectSilence(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#undo').click();
  expect((await storedScene(page)).blobs).toEqual(before.blobs);
  await expectSound(page);
});
