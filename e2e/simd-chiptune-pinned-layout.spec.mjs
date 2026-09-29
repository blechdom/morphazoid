import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const layouts = [
  { name: 'desktop', width: 1440, height: 900, coarse: false },
  { name: 'phone portrait', width: 390, height: 844, coarse: true },
  { name: 'phone landscape', width: 844, height: 390, coarse: true },
];
const pane = page => page.locator('.simd-sequencer-scroll');
const scrollTop = locator => locator.evaluate(element => element.scrollTop);
async function capture(page) {
  return page.evaluate(async () => (await import('./src/families/chiptune/chiptune-app.js')).captureChiptuneState());
}
async function open(page, baseURL) {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  expect((await page.goto('simd-chiptune.html'))?.ok()).toBe(true); await settlePage(page);
  await expect(page.locator('.simd-live-deck')).toHaveCount(1);
  await expect(pane(page)).toHaveAccessibleName('Scrollable sequencer');
  return diagnostics;
}
async function dockState(page) {
  return page.evaluate(() => {
    const selectors = ['.simd-live-deck', '.simd-live-settings', '.chiptune-character-panel', '#knobControls', '#panel-lead'];
    return Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector(selector), box = element.getBoundingClientRect();
      return [selector, { x: box.x, y: box.y, width: box.width, height: box.height,
        scrollTop: element.scrollTop, scrollLeft: element.scrollLeft }];
    }));
  });
}
async function expectHit(locator) {
  await locator.scrollIntoViewIfNeeded();
  expect(await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
}
async function gutter(page) {
  return pane(page).evaluate(element => {
    const box = element.getBoundingClientRect(), padding = parseFloat(getComputedStyle(element).paddingRight);
    if (padding < 24) throw new Error('Touch sequencer needs its native swipe gutter');
    const x = box.x + element.clientWidth - padding / 2;
    const from = { x, y: box.y + element.clientHeight - 28 }, to = { x, y: box.y + 28 };
    if (document.elementFromPoint(x, (from.y + to.y) / 2) !== element) throw new Error('The swipe gutter is covered by an editing target');
    return { from, to };
  });
}
async function swipe(page, from, to) {
  const session = await page.context().newCDPSession(page);
  try {
    const contact = ({ x, y }) => [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contact(from) });
    for (let index = 1; index <= 8; index++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contact({
        x: from.x + (to.x - from.x) * index / 8, y: from.y + (to.y - from.y) * index / 8 }) });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}

for (const layout of layouts) {
  test(`pinned controls and sequencer scroll independently at ${layout.name}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const diagnostics = await open(page, baseURL);
      await page.locator('[data-voice-view="lead"]').click();
      for (const selector of ['#simdPresetPicker > summary', '#nextPreset', '#randomizePatch', '#audioButton', '#synthPlayButton',
        '#knobControls [data-param-key="transpose"]', '[data-character-mute="lead"]', '[data-character-solo="lead"]',
        '[data-performer-volume="lead"] [role="slider"]']) await expectHit(page.locator(selector));
      for (const selector of ['#audioButton', '#synthPlayButton']) {
        const box = await page.locator(selector).boundingBox();
        if (layout.coarse) { expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48); }
      }
      const region = pane(page), regionBox = await region.boundingBox();
      expect(regionBox.height).toBeGreaterThanOrEqual(210);
      const deck = await page.locator('.simd-live-deck').boundingBox();
      if (layout.name === 'phone landscape') expect(deck.x + deck.width).toBeLessThanOrEqual(regionBox.x + 1);
      else expect(deck.y + deck.height).toBeLessThanOrEqual(regionBox.y + 1);
      const musical = await capture(page);
      await region.evaluate(element => { element.scrollTop = 0; });
      await settlePage(page); const dock = await dockState(page);
      const wheelPoint = layout.coarse ? (await gutter(page)).from : { x: regionBox.x + 12, y: regionBox.y + regionBox.height / 2 };
      await page.mouse.move(wheelPoint.x, wheelPoint.y); await page.mouse.wheel(0, 260);
      await expect.poll(() => scrollTop(region)).toBeGreaterThan(20);
      expect(await dockState(page)).toEqual(dock); expect(await capture(page)).toEqual(musical);
      // The focusable scroll region also honors its advertised keyboard action.
      await region.evaluate(element => { element.scrollTop = 0; }); await region.focus(); await page.keyboard.press('PageDown');
      await expect.poll(() => scrollTop(region)).toBeGreaterThan(20);
      expect(await dockState(page)).toEqual(dock); expect(await capture(page)).toEqual(musical);
      if (layout.coarse) {
        await region.evaluate(element => { element.scrollTop = 0; });
        const { from, to } = await gutter(page); await swipe(page, from, to);
        await expect.poll(() => scrollTop(region)).toBeGreaterThan(30);
        await page.waitForTimeout(200); const down = await scrollTop(region);
        await swipe(page, to, from); await expect.poll(() => scrollTop(region)).toBeLessThan(down - 10);
        expect(await dockState(page)).toEqual(dock); expect(await capture(page)).toEqual(musical);
      }
      // A voice's own scrolling panel must not drag the sequencer with it.
      const voicePanel = page.locator('#panel-lead'); await voicePanel.scrollIntoViewIfNeeded();
      const voiceScroll = await voicePanel.evaluate(element => {
        element.scrollTop = 0;
        const box = element.getBoundingClientRect(), point = { x: box.x + 4, y: box.y + 12 };
        if (document.elementFromPoint(point.x, point.y) !== element) throw new Error('Voice panel padding must be clear of knobs');
        return { ...point, maximum: element.scrollHeight - element.clientHeight };
      });
      expect(voiceScroll.maximum).toBeGreaterThan(0);
      await page.mouse.move(voiceScroll.x, voiceScroll.y);
      const sequenceBefore = await scrollTop(region); await page.mouse.wheel(0, 220);
      await expect.poll(() => scrollTop(voicePanel)).toBe(Math.min(220, voiceScroll.maximum));
      expect(await scrollTop(region)).toBe(sequenceBefore); expect(await capture(page)).toEqual(musical);
      await page.locator('#stage').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('pinned-layout.png') });
      expect(await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
        outerScroll: document.querySelector('#webgpuChiptune').scrollTop, bodyScroll: scrollY }))).toEqual({ overflow: 0, outerScroll: 0, bodyScroll: 0 });
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', 'false');
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test('pinned touch scrolling and orientation changes preserve the live performance', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    const diagnostics = await open(page, baseURL);
    await page.evaluate(async () => {
      const { SimdChiptuneAudio } = await import('./src/instruments/simd-chiptune/audio.js');
      const start = SimdChiptuneAudio.prototype.start; globalThis.__pinnedStarts = 0;
      SimdChiptuneAudio.prototype.start = function (...args) { globalThis.__pinnedEngine = this; globalThis.__pinnedStarts++; return start.apply(this, args); };
    });
    await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#synthPlayButton').click(); await waitForStableAudioState(page, true);
    const clock = () => page.evaluate(() => ({ starts: __pinnedStarts, anchor: __pinnedEngine.timelineStart,
      beat: __pinnedEngine.currentPlaybackBeat(), running: __pinnedEngine.running, context: __pinnedEngine.context.state }));
    const initial = await capture(page), before = await clock();
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size); await settlePage(page);
      await pane(page).evaluate(element => { element.scrollTop = 0; }); const dock = await dockState(page);
      const { from, to } = await gutter(page); await swipe(page, from, to);
      await expect.poll(() => scrollTop(pane(page))).toBeGreaterThan(20);
      expect(await dockState(page)).toEqual(dock); expect(await capture(page)).toEqual(initial);
    }
    const after = await clock(); expect(after.starts).toBe(before.starts); expect(after.anchor).toBe(before.anchor);
    expect(after.beat).toBeGreaterThan(before.beat); expect(after.running).toBe(true); expect(after.context).toBe('running');
    const audio = await sampleAudioEnvelope(page, { durationMs: 350 });
    expect(audio.summary.finite).toBe(true); expect(audio.summary.maxRms).toBeGreaterThan(.00001); expect(audio.summary.clippedSamples).toBe(0);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', 'true');
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  } finally { await context.close(); }
});
