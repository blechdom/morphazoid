import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => window.timeLoom.snapshot());
async function ready(page) {
  await page.goto('/time-loom.html');
  await page.waitForFunction(() => window.timeLoom);
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, v) => {
    input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
}

test('silent transport, granular sound, routed reading, live edits and release', async ({ page }, info) => {
  const failures = [];
  page.on('pageerror', e => failures.push(e.message));
  await ready(page);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator('#playButton').click();
  await expect.poll(async () => (await state(page)).position).toBeGreaterThan(.02);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await arm(page);
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  const sound = await sampleAudioEnvelope(page);
  expect(sound.summary.finite).toBe(true); expect(sound.summary.maxPeak).toBeGreaterThan(.001); expect(sound.summary.clippedSamples).toBe(0);
  await info.attach('time-loom-audio.json', { body: JSON.stringify(sound), contentType: 'application/json' });
  await range(page, 'end', .05); await range(page, 'stretch', .5);
  await page.locator('#nextCord').selectOption('1');
  await page.locator('#enterButton').click();
  await expect.poll(async () => (await state(page)).activeCord).toBe(1);
  await page.locator('[data-cord="1"]').click(); await page.locator('#reverseButton').click(); await range(page, 'stretch', 3);
  expect((await state(page)).playing).toBe(true); expect((await state(page)).armed).toBe(true);
  // A blocked rendering thread cannot stop the worklet's source clock.
  const point = (await state(page)).position;
  await page.evaluate(() => { const end = performance.now() + 350; while (performance.now() < end) {} });
  await expect.poll(async () => (await state(page)).position).not.toBe(point);
  await page.locator('#playButton').click();
  await page.waitForTimeout(150);
  const stopped = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(stopped.summary.maxPeak).toBeLessThan(.001);
  expect((await state(page)).armed).toBe(true);
  await page.locator('#audioButton').click(); expect((await state(page)).armed).toBe(false);
  expect(failures).toEqual([]);
});

test('knots, tassel, ties, reverse and one-step drag undo work by pointer and keys', async ({ page }) => {
  await ready(page);
  const before = await state(page);
  const geometry = await page.locator('#loom').evaluate(async canvas => {
    const { getLoomLayout } = await import('/src/instruments/time-loom/time-loom-renderer.js');
    const b = canvas.getBoundingClientRect(), g = getLoomLayout(b.width, b.height, window.timeLoom.snapshot().cords)[0];
    return { x: b.x + g.knotStart.x, y: b.y + g.knotStart.y, height: g.length };
  });
  await page.mouse.move(geometry.x, geometry.y); await page.mouse.down(); await page.mouse.move(geometry.x, geometry.y + geometry.height * .15, { steps: 7 }); await page.mouse.up();
  expect((await state(page)).cords[0].start).toBeGreaterThan(before.cords[0].start + .1);
  await page.locator('#undoButton').click(); expect((await state(page)).cords).toEqual(before.cords);
  await page.locator('#loom').focus(); await page.keyboard.press('2'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('r');
  const edited = await state(page); expect(edited.selected).toBe(1); expect(edited.cords[1].stretch).toBeGreaterThan(before.cords[1].stretch); expect(edited.cords[1].reverse).not.toBe(before.cords[1].reverse);
  await page.keyboard.press('t'); await page.keyboard.press('3'); expect((await state(page)).cords[1].next).toBe(2);
  await page.locator('[data-cord="1"]').click(); await page.locator('#untieButton').click(); expect((await state(page)).cords[1].next).toBeNull();
  await page.locator('#resetButton').click(); expect((await state(page)).cords).toEqual(before.cords);
});

test('presets and randomization preserve transport, sources, volume and Audio', async ({ page }) => {
  await ready(page); await page.locator('#playButton').click();
  const before = await state(page);
  await page.getByLabel('Choose full-instrument preset', { exact: true }).click();
  await page.getByRole('button', { name: 'A conversation', exact: true }).click();
  expect((await state(page)).cords[0].next).toBe(1);
  expect((await state(page)).playing).toBe(true); expect((await state(page)).armed).toBe(false);
  expect((await state(page)).sourceNames).toEqual(before.sourceNames);
  await page.getByRole('button', { name: /randomize.*parameter/i }).click();
  expect((await state(page)).playing).toBe(true); expect((await state(page)).armed).toBe(false);
});

test('recording with Audio off captures input and Undo restores the original', async ({ page }) => {
  await page.addInitScript(() => {
    window.fakeLoomMic = { stopped: 0 };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const ctx = new AudioContext(), target = ctx.createMediaStreamDestination(), oscillator = ctx.createOscillator(), gain = ctx.createGain();
      gain.gain.value = .2; oscillator.frequency.value = 237; oscillator.connect(gain).connect(target); oscillator.start(); await ctx.resume();
      for (const track of target.stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.fakeLoomMic.stopped++; stop(); void ctx.close(); }; }
      return target.stream;
    } });
  });
  await ready(page);
  await page.locator('.mz-audio-input-strip button').first().click();
  await expect(page.locator('#liveStatus')).toContainText('Microphone ready');
  expect((await state(page)).armed).toBe(false);
  await page.locator('#recordPhrase').click(); await expect.poll(async () => (await state(page)).recording).toBe(true);
  await page.waitForTimeout(650); await page.locator('#recordPhrase').click();
  await expect.poll(async () => (await state(page)).sourceNames[0]).toBe('Recorded phrase');
  const recorded = await state(page); expect(recorded.durations[0]).toBeGreaterThan(.1); expect(recorded.durations[0]).toBeLessThan(3); expect(recorded.armed).toBe(false);
  await page.locator('#undoButton').click(); expect((await state(page)).sourceNames).toEqual(['Original study', 'Original study', 'Original study']);
  await page.locator('.mz-audio-input-strip button').first().click();
  await expect.poll(() => page.evaluate(() => window.fakeLoomMic.stopped)).toBe(1);
});

function wavPhrase(seconds = 1) {
  const rate = 24000, frames = Math.round(rate * seconds), buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 283.7) * 12000), 44 + i * 2);
  return { name: 'phrase.wav', mimeType: 'audio/wav', buffer };
}

test('file import targets one cord, copies and undoes without arming Audio', async ({ page }) => {
  await ready(page);
  await page.locator('#captureTarget').selectOption('selected'); await page.locator('[data-cord="1"]').click();
  await page.locator('#audioFile').setInputFiles(wavPhrase(1.2));
  await expect.poll(async () => (await state(page)).sourceNames[1]).toBe('phrase.wav');
  expect((await state(page)).durations[1]).toBeCloseTo(1.2, 2);
  expect((await state(page)).sourceNames[0]).toBe('Original study'); expect((await state(page)).armed).toBe(false);
  await page.locator('#copyButton').click(); expect((await state(page)).sourceNames).toEqual(['phrase.wav', 'phrase.wav', 'phrase.wav']);
  await page.locator('#undoButton').click(); expect((await state(page)).sourceNames).toEqual(['Original study', 'phrase.wav', 'Original study']);
});

test('reset during a late file read cannot replace audio or leave loading controls locked', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function() {
      const file = this;
      return new Promise(resolve => { window.finishLoomRead = async () => resolve(await original.call(file)); });
    };
  });
  await page.locator('#audioFile').setInputFiles(wavPhrase());
  await page.waitForFunction(() => window.finishLoomRead);
  await page.locator('#resetButton').click(); await page.evaluate(() => window.finishLoomRead());
  await expect(page.locator('#loadButton')).toBeEnabled(); await expect(page.locator('#recordPhrase')).toBeEnabled();
  expect((await state(page)).sourceNames).toEqual(['Original study', 'Original study', 'Original study']);
});

test('cancelled microphone permission releases a late stream', async ({ page }) => {
  await page.addInitScript(() => {
    window.fakeLoomMic = { stopped: 0 };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: () => new Promise(resolve => {
      const ctx = new AudioContext(), target = ctx.createMediaStreamDestination();
      for (const track of target.stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.fakeLoomMic.stopped++; stop(); void ctx.close(); }; }
      window.resolveLoomMic = () => resolve(target.stream);
    }) });
  });
  await ready(page); await page.getByRole('button', { name: 'Activate microphone input', exact: true }).click();
  await page.waitForFunction(() => window.resolveLoomMic);
  await page.getByRole('button', { name: 'Cancel microphone input request', exact: true }).click();
  await page.evaluate(() => window.resolveLoomMic());
  await expect.poll(() => page.evaluate(() => window.fakeLoomMic.stopped)).toBe(1);
  expect((await state(page)).armed).toBe(false); expect((await state(page)).recording).toBe(false);
});

test('a cancelled touch drag restores its knot without consuming a prior undo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); await ready(page);
  await range(page, 'stretch', 2);
  const before = await state(page);
  const point = await page.locator('#loom').evaluate(async canvas => {
    const { getLoomLayout } = await import('/src/instruments/time-loom/time-loom-renderer.js');
    const box = canvas.getBoundingClientRect(), knot = getLoomLayout(box.width, box.height, window.timeLoom.snapshot().cords)[0].knotStart;
    return { x: box.x + knot.x, y: box.y + knot.y };
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 25 }] });
  expect((await state(page)).cords[0].start).toBeGreaterThan(before.cords[0].start);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect((await state(page)).cords).toEqual(before.cords);
  await page.locator('#undoButton').click(); expect((await state(page)).cords[0].stretch).toBe(1);
  await context.close();
});

test('page departure releases the graph and prevents late playback', async ({ page }) => {
  await ready(page); await arm(page); await page.locator('#playButton').click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await page.waitForTimeout(100); expect((await readAudioStatus(page)).active).toBe(false);
});

test('held reverse keys and untouched knots do not consume useful undo history', async ({ page }) => {
  await ready(page); await page.locator('#loom').focus();
  await page.keyboard.down('r');
  for (let i = 0; i < 12; i++) await page.keyboard.down('r');
  await page.keyboard.up('r'); await page.locator('#undoButton').click();
  expect((await state(page)).cords[0].reverse).toBe(false);
  for (let i = 1; i <= 8; i++) await range(page, 'stretch', 1 + i / 10);
  const point = await page.locator('#loom').evaluate(async canvas => {
    const { getLoomLayout } = await import('/src/instruments/time-loom/time-loom-renderer.js');
    const box = canvas.getBoundingClientRect(), knot = getLoomLayout(box.width, box.height, window.timeLoom.snapshot().cords)[0].knotStart;
    return { x: box.x + knot.x, y: box.y + knot.y };
  });
  for (let i = 0; i < 9; i++) await page.mouse.click(point.x, point.y);
  for (let i = 0; i < 8; i++) await page.locator('#undoButton').click();
  expect((await state(page)).cords[0].stretch).toBe(1);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    const page = await context.newPage(); await ready(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow).toBe(false);
    const preset = await page.locator('.header-preset-picker').boundingBox(); expect(preset.width).toBeGreaterThan(70);
    await page.locator('.header-preset-picker summary').click();
    await expect(page.getByRole('button', { name: 'A conversation', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const selector of ['#playButton', '#reverseButton', '#recordPhrase', '#resetButton']) { await page.locator(selector).scrollIntoViewIfNeeded(); await expect(page.locator(selector)).toBeVisible(); }
    const size = await page.locator('#loom').boundingBox(); expect(size.height).toBeGreaterThan(130); expect(size.width).toBeGreaterThan(250);
    await page.locator('#loom').scrollIntoViewIfNeeded();
    await info.attach(`time-loom-${viewport.width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    const axe = await new AxeBuilder({ page }).include('.loom-shell').disableRules(['color-contrast']).analyze();
    expect(axe.violations).toEqual([]);
    await context.close();
  });
}
