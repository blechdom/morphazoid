import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { ENVELOPE_PRESETS } from '../src/instruments/synthesis/envelope-presets.js';
import { NATIVE_METHODS, methodsForVoiceMode } from '../src/instruments/voicesaurus/native-model.js';

const state = page => page.evaluate(() => window.MorphazoidSynthesis.getState());
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
const appearance = locator => locator.evaluate(node => {
  const style = getComputedStyle(node), box = node.getBoundingClientRect();
  return { width: box.width, height: box.height, background: style.backgroundColor,
    color: style.color, border: style.border, radius: style.borderRadius };
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`transport joins the sticky preset dock and processor controls match at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html?method=fm&sequence=basic-up');
    for (const selector of ['#playButton', '#triggerButton', '#tempoControl', '.mz-tap-tempo']) {
      await expect(page.locator(`#performanceDock ${selector}`)).toBeVisible();
    }
    const dock = await page.locator('#performanceDock').boundingBox();
    const input = await page.locator('#inputBar').boundingBox();
    expect(dock.y + dock.height).toBeLessThanOrEqual(input.y + 1);
    await page.locator('#processorEnabled').check();
    const next = await appearance(page.locator('#nextPerformancePreset'));
    for (const id of ['nextProcessor', 'nextProcessorPreset', 'nextEnvelopePreset']) {
      expect(await appearance(page.locator(`#${id}`)), id).toEqual(next);
    }
    expect(await appearance(page.locator('#randomProcessor'))).toEqual(await appearance(page.locator('#randomMethod')));
    const restingDice = await appearance(page.locator('#randomMethod'));
    await page.locator('#randomMethod').click();
    await page.mouse.move(1, 1);
    expect(await appearance(page.locator('#randomMethod'))).toEqual(restingDice);
    await expect(page.locator('#randomMethod')).not.toHaveAttribute('aria-pressed', 'true');
    // Mobile uses the site's body scroll container; wheel drives the real owner.
    await page.mouse.move(viewport.width - 30, viewport.height - 30);
    await page.mouse.wheel(0, 1400);
    for (const selector of ['#playButton', '#triggerButton', '#tempoControl', '#scope', '#performancePresetHost']) {
      await expect(page.locator(selector)).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/synthesis-envelope-transport-${viewport.width}.png` });
  });
}

test('singing and speech method menus carry their historical milestone years', async ({ page }) => {
  await page.goto('/synthesis.html');
  for (const mode of ['singing', 'speech']) {
    await choose(page, 'inputCategory', mode);
    const options = await page.locator('.synthesis-voice-input select').evaluateAll(selects =>
      selects.map(select => [...select.options].map(option => ({ id: option.value, label: option.textContent, title: option.title }))));
    const methods = Object.keys(methodsForVoiceMode(mode === 'speech' ? 'speaking' : 'singing'));
    const menu = options.find(options => methods.every(id => options.some(option => option.id === id)));
    expect(menu).toBeDefined();
    for (const id of methods) expect(menu.find(option => option.id === id)).toEqual({
      id, label: `${NATIVE_METHODS[id].name} · ${NATIVE_METHODS[id].year}`, title: NATIVE_METHODS[id].date,
    });
  }
});

test('processor dice varies only the current processor and preserves source, notes, cursor and output', async ({ page }) => {
  await page.goto('/synthesis.html?method=fm&sequence=basic-up');
  await page.locator('#processorEnabled').check();
  await choose(page, 'processorPreset', 'fx-delay:slapback');
  const before = await state(page), sequence = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
  await page.locator('#randomProcessor').click();
  const after = await state(page), effect = after.routing.effect;
  expect(effect.methodId).toBe('fx-delay');
  expect(effect.presetId).toBe('custom');
  expect(effect.params).not.toEqual(before.routing.effect.params);
  expect(after).toEqual({ ...before, routing: { ...before.routing, effect } });
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState())).toEqual(sequence);
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
  await page.locator('#nextProcessorPreset').click();
  await expect(page.locator('#processorPreset')).not.toHaveValue('fx-delay:slapback');
  await expect(page.locator('#processorPreset')).not.toHaveValue('custom');
});

test('all 32 envelope presets have individually reachable circular handles on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/synthesis.html?method=additive');
  for (const preset of ENVELOPE_PRESETS) {
    await choose(page, 'envelopePresetSelect', preset.id);
    await page.locator('#envelopeControls').scrollIntoViewIfNeeded();
    const nodes = await page.locator('#envelopeControls [data-node]').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { index: node.dataset.node, width: box.width, height: box.height,
        hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('[data-node]')?.dataset.node };
    }));
    expect(nodes).toHaveLength(5);
    for (const node of nodes) { expect(node.hit, `${preset.id}/${node.index}`).toBe(node.index); expect(node.width).toBe(node.height); }
  }
});

test('all five nodes move independently, clicks do not edit, cancellation and resize preserve shape', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'envelopePresetSelect', 'double-bloom');
  const graph = page.locator('#envelopeControls'), before = await state(page);
  await graph.locator('[data-node="2"]').click();
  expect(await state(page)).toEqual(before);
  let previous = before.envelope.points;
  for (let index = 0; index < 5; index++) {
    const node = graph.locator(`[data-node="${index}"]`);
    await node.press(previous[index].level >= .99 ? 'ArrowDown' : 'ArrowUp');
    const next = (await state(page)).envelope.points;
    expect(next[index].level).not.toBe(previous[index].level);
    for (let other = 0; other < 5; other++) if (index !== other) expect(next[other]).toEqual(previous[other]);
    previous = next;
  }
  const node = graph.locator('[data-node="2"]');
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox(), envelope = (await state(page)).envelope;
  await page.mouse.move(box.x + 16, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 16, box.y + 36, { steps: 4 });
  expect((await state(page)).envelope.points[2].level).not.toBe(envelope.points[2].level);
  expect((await state(page)).envelope.points[3]).toEqual(envelope.points[3]);
  await graph.locator('.shared-amplitude-control').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  expect((await state(page)).envelope).toEqual(envelope);
  await node.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(node).toBeFocused();
  expect((await state(page)).envelope).toEqual(envelope);
  const snapshot = await page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
  expect(snapshot.sound.envelope).toEqual(envelope);
  await page.locator('#randomEnvelope').click();
  await expect(page.locator('#envelopePresetSelect')).toHaveValue('custom');
  expect((await state(page)).envelope.points).not.toEqual(envelope.points);
  expect(await status(page)).toMatchObject({ armed: false, playing: false });
});

for (const mode of ['mono', 'poly']) test(`point envelopes sound through the ${mode} worklet and release to silence`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'voiceMode', mode);
  await choose(page, 'envelopePresetSelect', 'release-bloom');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#triggerButton').click();
  await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeGreaterThan(.001);
  await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms, { timeout: 12_000 }).toBeLessThan(.00001);
  await page.locator('#playButton').click();
  await choose(page, 'envelopePresetSelect', 'double-bloom');
  await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeGreaterThan(.001);
  expect(await status(page)).toMatchObject({ armed: true, playing: true });
  await page.locator('#playButton').click();
  await expect.poll(async () => (await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms, { timeout: 12_000 }).toBeLessThan(.00001);
  await expect(page.locator('#audioError')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`touch envelope dragging owns the gesture without scrolling at ${viewport.width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto('/synthesis.html?method=additive');
      await choose(page, 'envelopePresetSelect', 'double-bloom');
      const node = page.locator('#envelopeControls [data-node="2"]');
      await node.scrollIntoViewIfNeeded();
      const box = await node.boundingBox(), before = (await state(page)).envelope.points;
      const scroll = await page.evaluate(() => [scrollY, document.body.scrollTop]);
      const client = await context.newCDPSession(page);
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: 2, radiusY: 2, force: .5, id: 1 };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 4, y: point.y + 12 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const after = (await state(page)).envelope.points;
      expect(after[2].level).toBeLessThan(before[2].level);
      expect(after[2].time).toBeGreaterThan(before[2].time);
      for (const index of [0, 1, 3, 4]) expect(after[index]).toEqual(before[index]);
      expect(await page.evaluate(() => [scrollY, document.body.scrollTop])).toEqual(scroll);
      expect(await status(page)).toMatchObject({ armed: false, playing: false });
    } finally { await context.close(); }
  });
}
