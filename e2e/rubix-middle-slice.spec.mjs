import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const layouts = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];
const centerId = 'front:1:1';
const geometry = (snapshot, id = centerId) => snapshot.geometry.find(item => item.sticker.id === id);
const center = snapshot => geometry(snapshot)?.projectedTriangles[0][0];

for (const owned of [false, true]) {
  const route = owned ? 'rubixoids' : 'rubix';
  const modulePath = `/src/instruments/${owned ? 'rubixoids/' : ''}rubix/rubix-app.js`;
  const snapshot = page => page.evaluate(async path => (await import(path)).rubixPlaybackSnapshot(), modulePath);
  for (const viewport of layouts) test.describe(`${route} middle slice at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, reducedMotion: 'no-preference' });
    test('center follows horizontal and vertical drags, completion and undo while audio keeps running', async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/${route}.html`);
      const pane = owned ? page.locator('.rubixoids-pane[data-dimension="3d"]') : page.locator('body');
      const audio = owned ? page.locator('body > .masthead #audioButton') : page.locator('#audioButton');
      const play = owned ? page.locator('.rubixoids-pane:not([hidden]) #playButton') : page.locator('#playButton');
      await pane.locator('#soundBank').selectOption('acid-303');
      await audio.click();
      await expect(audio).toHaveAttribute('aria-pressed', 'true');
      await play.click();
      await expect(play).toHaveAttribute('aria-pressed', 'true');
      await pane.locator('#stage').scrollIntoViewIfNeeded();
      const cdp = viewport.width === 1440 ? null : await page.context().newCDPSession(page);
      const touch = async (type, point) => cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : [],
      });
      const evidence = [];
      for (const dimension of ['horizontal', 'vertical']) {
        const before = await snapshot(page);
        const triangles = geometry(before).projectedTriangles;
        const [from, to] = dimension === 'horizontal' ? triangles[0].slice(1) : triangles[1].slice(1);
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const bounds = await pane.locator('#stage').boundingBox();
        const start = { x: bounds.x + center(before).x, y: bounds.y + center(before).y };
        // Follow the face's projected row/column rather than the screen axes.
        const distance = dimension === 'horizontal' ? 28 : -28;
        const end = { x: start.x + distance * (to.x - from.x) / length, y: start.y + distance * (to.y - from.y) / length };
        if (cdp) { await touch('touchStart', start); await touch('touchMove', end); }
        else { await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 4 }); }
        await expect.poll(async () => {
          const point = center(await snapshot(page));
          return point ? Math.hypot(point.x - center(before).x, point.y - center(before).y) : 0;
        }).toBeGreaterThan(2);
        const preview = await snapshot(page);
        expect(preview.scoreIds).toEqual(before.scoreIds); // Only the visual preview has advanced.
        await page.evaluate(async path => {
          const { rubixPlaybackSnapshot } = await import(path);
          window.sliceFrames = [];
          const until = performance.now() + 500;
          const sample = () => {
            const s = rubixPlaybackSnapshot();
            const g = s.geometry.find(item => item.sticker.id === 'front:1:1');
            window.sliceFrames.push({ score: s.scoreIds, center: g?.projectedTriangles[0][0] });
            if (performance.now() < until) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, modulePath);
        if (cdp) await touch('touchEnd'); else await page.mouse.up();
        await expect.poll(async () => (await snapshot(page)).scoreIds).not.toEqual(before.scoreIds);
        const after = await snapshot(page);
        const beforeCenter = before.scoreIds.find(id => id.startsWith(`${centerId}:`));
        expect(after.scoreIds.find(id => id.startsWith(`${centerId}:`))).not.toBe(beforeCenter);
        const animationFrames = await page.evaluate(() => window.sliceFrames);
        const moving = animationFrames.filter(frame => frame.center && JSON.stringify(frame.score) === JSON.stringify(before.scoreIds));
        expect(new Set(moving.map(frame => `${frame.center.x.toFixed(2)},${frame.center.y.toFixed(2)}`)).size).toBeGreaterThan(1);
        expect(after.playing).toBe(true);
        expect(after.simdTimelineStart).toBe(before.simdTimelineStart);
        expect(after.simdVoices).toBe(6);
        expect(after.audioTime).toBeGreaterThan(before.audioTime);
        await pane.locator('#undoMove').click();
        await expect.poll(async () => (await snapshot(page)).scoreIds).toEqual(before.scoreIds);
        await pane.locator('#stage').scrollIntoViewIfNeeded();
        evidence.push({ dimension, beforeCenter, afterCenter: after.scoreIds.find(id => id.startsWith(`${centerId}:`)), animationFrames: moving.length });
      }
      const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
      expect(envelope.summary.finite).toBe(true);
      expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
      expect(envelope.summary.clippedSamples).toBe(0);
      await info.attach('middle-slice.json', { body: JSON.stringify({ evidence, audio: envelope.summary }), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath('middle-slice.png') });
      expect(errors).toEqual([]);
      await audio.click();
    });
  });
}
