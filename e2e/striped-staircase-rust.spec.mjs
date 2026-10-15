import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const diagnostics = new WeakMap();
const snapshot = page => page.evaluate(() => window.__staircaseStudies.snapshot());

test.beforeEach(async ({ page, baseURL }) => {
  diagnostics.set(page, watchPageDiagnostics(page, { baseURL }));
});

test.afterEach(async ({ page }, info) => {
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await info.attach('staircase-browser-diagnostics.json', {
    body: JSON.stringify(messages, null, 2), contentType: 'application/json',
  });
  expect(messages, 'Staircase Studies has no browser or first-party resource errors').toEqual([]);
});

async function open(page) {
  const response = await page.goto('/striped-staircase-rust.html');
  expect(response?.ok()).toBe(true);
  await page.waitForFunction(() => window.__staircaseStudies?.snapshot().ready);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function playWithAudio(page) {
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await waitForAudioState(page, true);
  await expect.poll(async () => (await snapshot(page)).clock).toBeGreaterThan(0);
}

async function expectFieldSettled(page) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.ready && state.acceptedRevision === state.revision;
  }, { timeout: 15_000 }).toBe(true);
}

test('Play stays silent until Audio, Hold retains depth, Pause releases, and mute keeps the clock moving', async ({ page }, info) => {
  await open(page);
  const initial = await snapshot(page);
  expect(initial).toMatchObject({ audio: false, playing: false, hold: false });
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).progress).toBeGreaterThan(initial.progress);
  expect((await snapshot(page)).audio).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  const silentPhase = (await snapshot(page)).progress;
  await page.locator('#audioButton').click();
  await waitForAudioState(page, true);
  expect((await snapshot(page)).progress).toBeGreaterThanOrEqual(silentPhase - .005);
  await page.locator('#holdButton').click();
  await page.waitForTimeout(150);
  const held = await snapshot(page);
  await page.waitForTimeout(350);
  const stillHeld = await snapshot(page);
  expect(stillHeld).toMatchObject({ audio: true, playing: true, hold: true });
  expect(stillHeld.progress).toBeCloseTo(held.progress, 7);
  expect(stillHeld.clock).toBeGreaterThan(held.clock);
  await waitForAudioState(page, true);

  await setRange(page, 'progress', .42);
  await expect.poll(async () => (await snapshot(page)).progress).toBeCloseTo(.42, 3);
  await page.locator('#playButton').click();
  await waitForStableAudioState(page, false);
  expect((await snapshot(page)).audio).toBe(true);
  await page.locator('#holdButton').click();
  await page.locator('#playButton').click();
  await waitForAudioState(page, true);
  await page.locator('#audioButton').click();
  await waitForStableAudioState(page, false);
  const muted = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).progress).toBeGreaterThan(muted.progress);
  const later = await snapshot(page);
  expect(later).toMatchObject({ audio: false, playing: true });
  expect(later.clock).toBeGreaterThan(muted.clock);
  await info.attach('transport-states.json', {
    body: JSON.stringify({ initial, held, stillHeld, muted, later }, null, 2), contentType: 'application/json',
  });
});

test('all four sonifications preserve live transport and produce bounded output', async ({ page }, info) => {
  await open(page);
  await playWithAudio(page);
  const modes = [];
  for (const mode of [0, 1, 2, 3, 0]) {
    const before = await snapshot(page);
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect.poll(async () => (await snapshot(page)).mode).toBe(mode);
    const after = await snapshot(page);
    expect(after).toMatchObject({ playing: true, audio: true, hold: false });
    expect(after.progress).toBeGreaterThanOrEqual(before.progress - .005);
    const envelope = await sampleAudioEnvelope(page, { durationMs: mode === 2 ? 1200 : 400 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxRms).toBeGreaterThan(.00001);
    expect(envelope.summary.maxPeak).toBeLessThan(1);
    expect(envelope.summary.clippedSamples).toBe(0);
    modes.push({ mode, before, after, ...envelope.summary });
  }
  await info.attach('sonification-output.json', { body: JSON.stringify(modes, null, 2), contentType: 'application/json' });
});

test('output level changes the measured signal, zero stays silent, and teardown removes the output', async ({ page }, info) => {
  await open(page);
  await playWithAudio(page);
  await page.locator('#holdButton').click();
  await setRange(page, 'level', .05);
  await page.waitForTimeout(200);
  const quiet = await sampleAudioEnvelope(page, { durationMs: 400 });
  await setRange(page, 'level', .5);
  await page.waitForTimeout(200);
  const loud = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(loud.summary.meanRms).toBeGreaterThan(quiet.summary.meanRms * 3);
  expect(loud.summary.maxPeak).toBeLessThan(1);
  await setRange(page, 'level', 0);
  await waitForStableAudioState(page, false);
  expect((await snapshot(page)).audio).toBe(true);
  await setRange(page, 'level', .2);
  await waitForAudioState(page, true);
  await page.evaluate(() => window.__staircaseStudies.teardown());
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await waitForStableAudioState(page, false);
  await info.attach('output-level.json', {
    body: JSON.stringify({ quiet: quiet.summary, loud: loud.summary }, null, 2), contentType: 'application/json',
  });
});

test('recorded PCM and the Rust sample clock continue through a 300 ms UI stall', async ({ page }, info) => {
  await open(page);
  await playWithAudio(page);
  const evidence = await page.evaluate(async () => {
    const { OutputRecorder } = await import('/src/output-recorder.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager();
    const recorder = new OutputRecorder({ manager });
    await recorder.start();
    const context = manager.recordingContext();
    const before = window.__staircaseStudies.snapshot(), start = context.currentTime;
    await new Promise(resolve => setTimeout(resolve, 250));
    const stallStart = context.currentTime, until = performance.now() + 300;
    while (performance.now() < until) { /* Audio must not depend on UI callbacks. */ }
    const stallEnd = context.currentTime;
    await new Promise(resolve => setTimeout(resolve, 250));
    const after = window.__staircaseStudies.snapshot(), elapsed = context.currentTime - start;
    const take = await recorder.stop();
    const bytes = new Uint8Array(await take.blob.arrayBuffer());
    const frames = (bytes.length - 44) / 6, windowFrames = Math.round(take.sampleRate * .01);
    const rms = [];
    for (let at = windowFrames; at + windowFrames < frames; at += windowFrames) {
      let power = 0;
      for (let frame = at; frame < at + windowFrames; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const offset = 44 + frame * 6 + channel * 3;
          const integer = (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16) << 8 >> 8;
          power += (integer / 8388608) ** 2;
        }
      }
      rms.push(Math.sqrt(power / (windowFrames * 2)));
    }
    recorder.discard();
    return { before, after, error: take.error, sampleRate: take.sampleRate,
      seconds: frames / take.sampleRate, elapsed, stallSeconds: stallEnd - stallStart, rms };
  });
  expect(evidence.error).toBe('');
  expect(evidence.stallSeconds).toBeGreaterThan(.2);
  expect(evidence.seconds).toBeGreaterThan(.7);
  expect(Math.abs(evidence.seconds - evidence.elapsed)).toBeLessThan(.05);
  expect(evidence.after.clock - evidence.before.clock).toBeGreaterThan(evidence.sampleRate * .6);
  expect(evidence.after.progress).toBeGreaterThan(evidence.before.progress);
  expect(evidence.rms.every(Number.isFinite)).toBe(true);
  expect(Math.min(...evidence.rms)).toBeGreaterThan(.00001);
  await info.attach('pcm-through-ui-stall.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('view recall, drag, wheel, and keyboard install the latest field without stopping playback', async ({ page }) => {
  await open(page);
  await playWithAudio(page);
  const initial = await snapshot(page);
  const options = await page.locator('#viewPreset option').evaluateAll(nodes => nodes.map(node => node.value));
  const current = await page.locator('#viewPreset').inputValue();
  await page.locator('#viewPreset').selectOption(options.find(value => value !== current && value));
  await expectFieldSettled(page);
  expect((await snapshot(page)).acceptedRevision).toBeGreaterThan(initial.acceptedRevision);

  const stage = page.locator('#stage');
  const box = await stage.boundingBox();
  const beforeDrag = await snapshot(page);
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .54, { steps: 5 });
  await page.mouse.up();
  await expectFieldSettled(page);
  expect((await snapshot(page)).camera).not.toEqual(beforeDrag.camera);
  const beforeWheel = await snapshot(page);
  await page.mouse.wheel(0, -180);
  await expect.poll(async () => (await snapshot(page)).camera.scale).not.toBe(beforeWheel.camera.scale);
  await expectFieldSettled(page);
  await stage.focus();
  const beforeKeys = await snapshot(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('+');
  await expectFieldSettled(page);
  const final = await snapshot(page);
  expect(final.camera).not.toEqual(beforeKeys.camera);
  expect(final).toMatchObject({ audio: true, playing: true });
  await expect.poll(async () => (await snapshot(page)).audioRevision).toBe(final.acceptedRevision);
  await waitForAudioState(page, true);
});

for (const viewport of [
  { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    test('controls remain reachable and stage input stays usable', async ({ page }, info) => {
      await open(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      await page.locator('.study-section details > summary').click();
      const selectors = [
        ...['audioButton', 'playButton', 'holdButton', 'progress', 'speed', 'baseFrequency', 'brightness', 'body',
          'viewPreset', 'palette', 'startIteration', 'maxIterations', 'steps', 'stripePeriod', 'resetAll',
          'zoomIn', 'zoomOut', 'homeView'].map(id => `#${id}`),
        ...[0, 1, 2, 3].map(mode => `[data-mode="${mode}"]`),
      ];
      for (const selector of selectors) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        expect(await control.evaluate(element => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.left >= -2 && box.right <= innerWidth + 2 && (element === hit || element.contains(hit));
        }), `${selector} is reachable at ${viewport.width}×${viewport.height}`).toBe(true);
      }
      if (viewport.width !== 1440) {
        for (const id of ['audioButton', 'playButton']) {
          const box = await page.locator(`#${id}`).boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
        // scrollIntoView can move overflow:hidden ancestors programmatically.
        // A touch drag outside the stage must also scroll the actual page.
        const client = await page.context().newCDPSession(page);
        const notes = page.locator('.mode-description');
        await notes.scrollIntoViewIfNeeded();
        const notesBox = await notes.boundingBox();
        const scrollBefore = await page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop);
        const touchX = Math.round(notesBox.x + notesBox.width / 2);
        const touchY = Math.round(notesBox.y + notesBox.height / 2);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
        for (let step = 1; step <= 6; step++) {
          await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX, y: touchY - step * 16 }] });
          await page.waitForTimeout(20);
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop)).toBeGreaterThan(scrollBefore + 30);
        const stage = page.locator('#stage');
        await stage.scrollIntoViewIfNeeded();
        const box = await stage.boundingBox(), before = await snapshot(page);
        const y = Math.round(box.y + box.height / 2), x = Math.round(box.x + box.width / 2);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 25, y }, { x: x + 25, y }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 50, y }, { x: x + 50, y }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(async () => (await snapshot(page)).camera.scale).not.toBe(before.camera.scale);
        await expectFieldSettled(page);
        expect((await snapshot(page)).audio).toBe(false);
        await client.detach();
      }
      await page.screenshot({ path: info.outputPath('staircase-layout.png'), fullPage: true });
    });
  });
}
