import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

// A sustained church-organ C4 lets the pad play/release the same pitch without
// confusing the piano's natural decay with the file player's note ownership.
const sustainedMidi = Buffer.from([
  77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
  77, 84, 114, 107, 0, 0, 0, 23,
  0, 255, 81, 3, 7, 161, 32,
  0, 192, 19, 0, 144, 60, 80,
  158, 0, 128, 60, 0, 0, 255, 47, 0,
]);

async function open(page) {
  await page.addInitScript(() => {
    window.__padAudioContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__padAudioContexts.push(this); }
    };
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#notePads button')).toHaveCount(24);
  await expect(page.locator('#songSelect option')).not.toHaveCount(0);
}

async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 15000 });
}

async function range(page, id, value, event = 'input') {
  await page.locator(`#${id}`).evaluate((node, next) => {
    node.value = String(next.value);
    node.dispatchEvent(new Event(next.event, { bubbles: true }));
  }, { value, event });
}

async function pressPointer(page, note = 60) {
  const pad = page.locator(`#notePads [data-note="${note}"]`);
  await pad.scrollIntoViewIfNeeded();
  await pad.evaluate(node => node.addEventListener('pointerdown', event => {
    node.dataset.testPointerId = String(event.pointerId);
  }, { once: true }));
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(pad).toHaveAttribute('aria-pressed', 'true');
  return pad;
}

async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 6000 }).toBeLessThan(.0001);
}

async function audible(page, durationMs = 500) {
  const sample = await sampleAudioEnvelope(page, { durationMs, intervalMs: 40 });
  expect(sample.summary.finite).toBe(true);
  expect(sample.summary.maxRms).toBeGreaterThan(.001);
  expect(sample.summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(sample.summary.clippedSamples).toBe(0);
  return sample.summary;
}

test('pads never arm Audio or replay presses made while muted', async ({ page }) => {
  await open(page);
  const pad = page.locator('#notePads [data-note="60"]');
  await pad.focus(); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
  await pad.evaluate(node => node.click());
  await page.waitForTimeout(250);
  await pressPointer(page);
  expect(await page.evaluate(() => window.__padAudioContexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');

  // Activate Audio without releasing the already-held pointer. This is an
  // explicit Audio-button action, not permission to replay the old pad press.
  await page.locator('#audioButton').evaluate(node => node.click());
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 15000 });
  const priorPress = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(priorPress.summary.maxPeak).toBeLessThan(.0001);
  await page.mouse.up();
  await pressPointer(page); await audible(page);
  await page.locator('#audioButton').evaluate(node => node.click());
  await silent(page); await page.mouse.up();

  await pressPointer(page);
  await page.locator('#audioButton').evaluate(node => node.click());
  await expect(page.locator('#audioState')).toHaveText('on');
  const mutedPress = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(mutedPress.summary.maxPeak).toBeLessThan(.0001);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__padAudioContexts.length)).toBe(1);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('audible pointer pads release on up, cancel, window blur and Reset', async ({ page }) => {
  test.setTimeout(45000);
  await open(page); await arm(page);
  for (const release of ['up', 'cancel', 'blur', 'reset']) {
    const pad = await pressPointer(page);
    await audible(page);
    if (release === 'up') await page.mouse.up();
    if (release === 'cancel') await pad.evaluate(node => node.dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true, pointerId: Number(node.dataset.testPointerId), pointerType: 'mouse',
    })));
    if (release === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (release === 'reset') await page.locator('#resetButton').evaluate(node => node.click());
    await expect(pad).toHaveAttribute('aria-pressed', 'false');
    await silent(page);
    if (release !== 'up') await page.mouse.up();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  }
});

test('keyboard and assistive pad actions sound; pad velocity and shared volume affect output', async ({ page }) => {
  test.setTimeout(45000);
  await open(page); await arm(page);
  const pad = page.locator('#notePads [data-note="48"]');
  const levels = [];
  for (const [key, velocity] of [['Enter', 25], ['Space', 120]]) {
    await range(page, 'padVelocity', velocity);
    await pad.focus(); await page.keyboard.down(key);
    levels.push(await audible(page, 700));
    await page.keyboard.up(key);
    await silent(page);
  }
  expect(levels[1].meanRms).toBeGreaterThan(levels[0].meanRms * 2);
  await range(page, 'outputLevel', 0);
  await pad.focus(); await page.keyboard.down('Enter');
  const muted = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(muted.summary.maxPeak).toBeLessThan(.0001);
  await range(page, 'outputLevel', 1);
  await audible(page);
  await page.keyboard.up('Enter'); await silent(page);
  await pad.evaluate(node => node.click());
  await audible(page, 300); await silent(page);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('pads and file notes keep independent ownership through release, stop and seek', async ({ page }) => {
  test.setTimeout(30000);
  await open(page);
  await page.locator('#midiFile').setInputFiles({ name: 'Sustained C4.mid', mimeType: 'audio/midi', buffer: sustainedMidi });
  await arm(page); await expect(page.locator('#playButton')).toBeEnabled();
  await page.locator('#playButton').click();
  await audible(page);
  const before = Number(await page.locator('#songPosition').inputValue());
  await pressPointer(page, 60); await audible(page);
  await page.mouse.up();
  await page.waitForTimeout(2500);
  // If pad note-off reaches the file synth, this sustained organ disappears.
  await audible(page);
  expect(Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(before + 2);

  const pad = await pressPointer(page, 48);
  await audible(page, 300);
  await page.locator('#stopButton').evaluate(node => node.click());
  await expect(page.locator('#songPosition')).toHaveValue('0');
  await expect(pad).toHaveAttribute('aria-pressed', 'true');
  await audible(page, 300);
  await range(page, 'songPosition', 5, 'change');
  await expect(pad).toHaveAttribute('aria-pressed', 'true');
  await audible(page, 300);
  await page.mouse.up(); await silent(page);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__padAudioContexts.length)).toBe(1);
});

test('a broken MIDI does not disable pads and pagehide disposes their audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); await arm(page);
  await page.locator('#midiFile').setInputFiles({ name: 'Broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('not midi') });
  await expect(page.locator('#playButton')).toBeDisabled();
  await pressPointer(page); await audible(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__padAudioContexts.every(context => context.state === 'closed'))).toBe(true);
  await page.mouse.up();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#notePads [aria-pressed="true"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
