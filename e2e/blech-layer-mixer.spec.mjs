import { test, expect } from '@playwright/test';

async function open(page) {
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst originalLayerVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){globalThis.__layerMixer=this;return originalLayerVolume.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
}
const snapshot = page => page.evaluate(() => __layerMixer.state.samples.map(sample => ({
  id: sample.id, muted: sample.muted, solo: sample.solo, effectiveMuted: sample.effectiveMuted,
  pan: sample.pan, gain: sample.gain, channel: sample.channel, loop: sample.loop, paused: sample.paused,
  position: sample.positionBeats + sample.cycle * sample.analysis.durationBeats,
  channels: [...new Set(sample.analysis.notes.map(note => note.channel))],
})));
const row = (page, id) => page.locator(`.blech-live-layer[data-sample-id="${id}"]`);
async function drop(page) {
  await page.locator('#blechDropLoop').click();
  await page.locator('#blechDropDelay').fill('0'); await page.locator('#blechDropDelay').press('Tab');
  await page.locator('#blechDropSend').click();
}
async function mixPair(page) {
  await drop(page);
  await page.locator('#blechTab-frames').click();
  await expect(page.locator('#blechDropSend')).toBeEnabled(); await drop(page);
  await expect(page.locator('.blech-live-layer')).toHaveCount(2);
  return snapshot(page);
}
async function setRange(locator, value) {
  await locator.evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

test('Math opens first and mixed-generator layers share independent mute, solo, route and tiny knobs', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(page.getByRole('tablist', { name: 'Generators', exact: true }).getByRole('tab').first()).toHaveText('Math');
  await expect(page.locator('#blechTab-math')).toHaveAttribute('aria-selected', 'true');
  const [math, stamp] = await mixPair(page);
  await expect(page.locator('#creativePadsHost .mixer-saved-pad:visible')).toHaveCount(0);
  expect(await page.locator('#blechLiveLayers').evaluate(node => Boolean(node.closest('[role="tabpanel"]')))).toBe(false);
  const mathRow = row(page, math.id), stampRow = row(page, stamp.id);
  await expect(mathRow.locator('.mixer-range-knob')).toHaveCount(2);
  await expect(stampRow).toHaveAttribute('data-selected', 'true');
  const mathSource = await mathRow.getAttribute('data-spigot-id'), stampSource = await stampRow.getAttribute('data-spigot-id');
  expect(mathSource).toBeTruthy(); expect(stampSource).not.toBe(mathSource);
  await mathRow.locator('[data-layer-select]').focus(); await page.keyboard.press('Enter');
  await expect(mathRow).toHaveAttribute('data-selected', 'true');
  await expect(stampRow).toHaveAttribute('data-selected', 'false');
  await expect(mathRow.locator('[data-layer-select]')).toHaveAttribute('aria-pressed', 'true');
  await stampRow.locator('.blech-layer-timeline').click();
  await expect(stampRow).toHaveAttribute('data-selected', 'true');
  await mathRow.locator('[data-layer-mute]').click();
  await expect(stampRow).toHaveAttribute('data-selected', 'true');
  expect((await snapshot(page))[0]).toMatchObject({ muted: true, effectiveMuted: true, paused: false });
  await expect(mathRow).toHaveAttribute('data-muted', 'true');
  const mutedAt = (await snapshot(page))[0].position;
  await expect.poll(async () => (await snapshot(page))[0].position).toBeGreaterThan(mutedAt + .1);
  await mathRow.locator('[data-layer-mute]').click(); await mathRow.locator('[data-layer-solo]').click();
  expect((await snapshot(page)).map(item => item.effectiveMuted)).toEqual([false, true]);
  await expect(stampRow).toHaveAttribute('data-muted', 'true');
  await setRange(mathRow.locator('[data-layer-gain]'), .27); await setRange(mathRow.locator('[data-layer-pan]'), -.6);
  await mathRow.locator('[data-layer-channel]').selectOption({ value: '4' });
  expect((await snapshot(page))[0]).toMatchObject({ gain: .27, pan: -.6, channel: 4, channels: [4] });
  expect((await snapshot(page))[1]).toMatchObject({ gain: stamp.gain, pan: 0, channel: stamp.channel });
  await page.locator('#blechTab-text').click(); await expect(mathRow).toBeVisible(); await expect(stampRow).toBeVisible();
  await mathRow.locator('[data-layer-stop]').click();
  await expect(mathRow).toHaveCount(0);
  expect(await snapshot(page)).toEqual([expect.objectContaining({ id: stamp.id, effectiveMuted: false })]);
  await stampRow.locator('[data-layer-loop]').uncheck();
  await expect(stampRow.locator('[data-layer-loop]')).not.toBeChecked();
  expect((await snapshot(page)).find(sample => sample.id === stamp.id)?.loop ?? false).toBe(false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`layer strips fit and remain reachable at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await open(page);
    const pair = await mixPair(page);
    for (const source of ['math', 'frames', 'sound']) {
      await page.locator(`#blechTab-${source}`).click();
      for (const sample of pair) {
        const strip = row(page, sample.id);
        for (const control of ['pause', 'mute', 'solo', 'loop', 'gain', 'channel', 'pan', 'stop']) {
          const target = strip.locator(`[data-layer-${control}]`); await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        }
        expect((await strip.boundingBox()).height).toBeLessThanOrEqual(34);
        const centers = await strip.evaluate(node => [...node.children].map(child => { const box = child.getBoundingClientRect(); return box.y + box.height / 2; }));
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
      }
    }
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - innerWidth,
      strips: [...document.querySelectorAll('.blech-live-layer')].map(node => node.scrollWidth - node.clientWidth),
      layerOverflow: getComputedStyle(document.querySelector('#blechLiveLayers')).overflowX,
    }));
    expect(overflow.document).toBeLessThanOrEqual(1); expect(Math.max(...overflow.strips)).toBeLessThanOrEqual(1); expect(overflow.layerOverflow).toBe('auto');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  });
}


test.describe('coarse-pointer layer strips', () => {
  test.use({ hasTouch: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`stay one line with reachable 48px controls at ${viewport.width} × ${viewport.height}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(viewport); await open(page);
      const pair = await mixPair(page);
      for (const sample of pair) {
        const strip = row(page, sample.id);
        expect((await strip.boundingBox()).height).toBeLessThanOrEqual(54);
        for (const key of ['select', 'pause', 'mute', 'solo', 'loop', 'gain', 'channel', 'pan', 'stop']) {
          const control = strip.locator(`[data-layer-${key}]`);
          await control.scrollIntoViewIfNeeded();
          const box = await control.boundingBox();
          expect(box.height).toBeGreaterThanOrEqual(48);
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        }
      }
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    });
  }
});
