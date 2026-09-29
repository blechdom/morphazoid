import { expect, test } from '@playwright/test';
import { revealLocalPoints } from './helpers/simd-sequence-viewport.mjs';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const pitched = ['bass', 'lead', 'upperOne', 'upperTwo'];
const layouts = [
  { name: 'desktop', width: 1440, height: 900, coarse: false },
  { name: 'phone portrait', width: 390, height: 844, coarse: true },
  { name: 'phone landscape', width: 844, height: 390, coarse: true },
];
const xScroll = page => page.locator('#simdSequenceScrollX');
const yScroll = page => page.locator('#simdSequenceScrollY');
const zoom = page => page.locator('[data-editor-knob="zoom"] [role="slider"]');
const pitchView = page => page.locator('[data-editor-knob="pitch"] [role="slider"]');
async function capture(page) {
  return page.evaluate(async () => (await import('./src/families/chiptune/chiptune-app.js')).captureChiptuneState());
}
async function open(page, baseURL) {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.addInitScript(() => {
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      if (this.canvas.id === 'stage' && x === 0 && y === 0 && width >= this.canvas.width && height >= this.canvas.height) this.canvas.__rollLabels = [];
      return fillRect.call(this, x, y, width, height);
    };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (this.canvas.id === 'stage') { this.canvas.__rollLabels ??= []; this.canvas.__rollLabels.push(String(args[0])); }
      return fillText.apply(this, args);
    };
  });
  expect((await page.goto('simd-chiptune.html'))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator('[data-character-voice]')).toHaveCount(7);
  return diagnostics;
}
async function selectVoice(page, voice) {
  // The native face switch selects its performer and scrolls safely past sticky
  // chrome. A second click restores the original Dance/Controls presentation.
  const button = page.locator(`[data-voice-view="${voice}"]`);
  await button.click(); await button.click();
  await expect(page.locator('#stageWrap')).toHaveAttribute('data-performer', voice);
}
async function hitTarget(page, point, selector) {
  expect(await page.evaluate(({ point, selector }) => {
    const target = document.querySelector(selector), hit = document.elementFromPoint(point.x, point.y);
    return Boolean(target && (hit === target || target.contains(hit)));
  }, { point, selector }), `${selector} must receive input at ${JSON.stringify(point)}`).toBe(true);
}
async function scrollPoint(scrollbar, end = false) {
  const track = scrollbar.locator('.simd-scroll-track'), box = await track.boundingBox();
  const vertical = await scrollbar.getAttribute('aria-orientation') === 'vertical';
  const [point] = await revealLocalPoints(track, [{ x: vertical ? box.width / 2 : end ? box.width - 1 : 1,
    y: vertical ? end ? box.height - 1 : 1 : box.height / 2 }]);
  return point;
}
async function stroke(page, from, to, coarse = false) {
  if (!coarse) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y); await page.mouse.up(); return;
  }
  const session = await page.context().newCDPSession(page);
  try {
    const points = ({ x, y }) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(to) });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await session.detach(); }
}
async function rollGrid(page, steps = 8) {
  const canvas = page.locator('#stage'); await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(), narrow = box.width <= 620;
  const left = narrow ? 45 : 66, right = narrow ? 5 : 10, top = narrow ? 38 : 42;
  const overviewHeight = Math.min(88, Math.max(66, box.height * .23));
  const overviewTop = box.height - 17 - overviewHeight;
  const bottom = Math.max(top + 120, overviewTop - 15), rowHeight = bottom - top;
  const padding = Math.min(18, rowHeight * .1);
  const x = offset => box.x + left + (offset + .5) * (box.width - left - right) / steps;
  const reveal = (...points) => revealLocalPoints(canvas, points.map(point => ({ x: point.x - box.x, y: point.y - box.y })));
  return { box, canvas, reveal, pitch: (offset, unit) => ({ x: x(offset), y: box.y + top + padding + (1 - unit) * (rowHeight - 2 * padding) }),
    volume: (offset, unit) => ({ x: x(offset), y: box.y + overviewTop + 13 + (1 - unit) * (overviewHeight - 13) }) };
}
async function expectPage(page, label) {
  await expect.poll(() => page.locator('#stage').evaluate(canvas => canvas.__rollLabels?.find(text => /^\d{2}–\d{2}$/.test(text)))).toBe(label);
}

for (const layout of layouts) {
  test(`compact piano roll supports navigation and pitch/volume edits at ${layout.name}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const diagnostics = await open(page, baseURL);
      for (const voice of [...pitched, 'arp']) {
        await selectVoice(page, voice);
        const grid = await rollGrid(page, 32);
        expect(grid.box.height).toBeLessThanOrEqual(layout.height < 500 ? 251 : 301);
        expect(grid.box.height).toBeGreaterThanOrEqual(240);
        await hitTarget(page, (await grid.reveal(grid.pitch(2, .5)))[0], '#stage');
        await hitTarget(page, (await grid.reveal(grid.volume(2, .5)))[0], '#stage');
      }
      await selectVoice(page, 'lead');
      await zoom(page).press('Home');
      const initial = await capture(page);
      await rollGrid(page);
      for (const [scrollbar, selector] of [[xScroll(page), '#simdSequenceScrollX'], [yScroll(page), '#simdSequenceScrollY']]) {
        await expect(scrollbar).toBeVisible(); await expect(scrollbar).toHaveAttribute('aria-controls', 'stage');
        const box = await scrollbar.boundingBox();
        const [center] = await revealLocalPoints(scrollbar, [{ x: box.width / 2, y: box.height / 2 }]);
        await hitTarget(page, center, selector);
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(layout.coarse ? 36 : 22);
        const minimum = await scrollbar.getAttribute('aria-valuemin'), maximum = await scrollbar.getAttribute('aria-valuemax');
        await scrollbar.press('End'); await expect(scrollbar).toHaveAttribute('aria-valuenow', maximum);
        await expect(scrollbar).toBeFocused();
        const first = await scrollPoint(scrollbar); await hitTarget(page, first, selector);
        if (layout.coarse) await page.touchscreen.tap(first.x, first.y); else await page.mouse.click(first.x, first.y);
        await expect(scrollbar).toHaveAttribute('aria-valuenow', minimum);
        const last = await scrollPoint(scrollbar, true); await hitTarget(page, last, selector);
        if (layout.coarse) await page.touchscreen.tap(last.x, last.y); else await page.mouse.click(last.x, last.y);
        await expect(scrollbar).toHaveAttribute('aria-valuenow', maximum);
        await scrollbar.press('Home'); await expect(scrollbar).toHaveAttribute('aria-valuenow', minimum);
      }
      await xScroll(page).press('End'); await expectPage(page, '25–32');
      const start = await scrollPoint(xScroll(page));
      const thumb = await xScroll(page).locator('.simd-scroll-thumb').boundingBox();
      await stroke(page, { x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2 }, start, layout.coarse);
      await expect(xScroll(page)).toHaveAttribute('aria-valuenow', '0'); await expectPage(page, '01–08');
      expect(await capture(page)).toEqual(initial);
      // Capture the compact roll with both scrollbars and its ordinary note range.
      await yScroll(page).press('Home'); for (let i = 0; i < 3; i++) await yScroll(page).press('PageDown');
      await page.screenshot({ path: testInfo.outputPath('piano-roll.png') });
      // View controls select a later page and high register without transposing notes.
      await pitchView(page).press('Home'); await xScroll(page).press('Home'); await xScroll(page).press('ArrowRight');
      await yScroll(page).press('Home'); await expectPage(page, '09–16');
      expect(await capture(page)).toEqual(initial);
      let grid = await rollGrid(page);
      const pitchPoints = await grid.reveal(grid.pitch(2, .2), grid.pitch(2, .8));
      await stroke(page, ...pitchPoints, layout.coarse);
      const note = await capture(page), edited = note.sequence.lanes.lead.cells[10];
      expect(edited.state).toBe('note'); expect(edited.value).toBeGreaterThanOrEqual(66); expect(edited.value).toBeLessThanOrEqual(69);
      expect(note.parameters).toEqual(initial.parameters);
      for (const [lane, value] of Object.entries(initial.sequence.lanes)) if (lane !== 'lead') expect(note.sequence.lanes[lane]).toEqual(value);
      for (let step = 0; step < 32; step++) if (step !== 10) expect(note.sequence.lanes.lead.cells[step]).toEqual(initial.sequence.lanes.lead.cells[step]);
      grid = await rollGrid(page);
      await stroke(page, ...await grid.reveal(grid.volume(2, .8), grid.volume(2, .25)), layout.coarse);
      const quieter = await capture(page);
      expect(quieter.sequence.lanes.lead.cells[10]).toMatchObject({ state: 'note', value: edited.value });
      expect(quieter.sequence.lanes.lead.cells[10].velocity).toBeCloseTo(.25, 1);
      const restored = structuredClone(quieter.sequence); restored.lanes.lead.cells[10] = edited;
      expect(restored).toEqual(note.sequence);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test('scrollbars appear only for hidden steps or pitches, with no duplicate pan knobs', async ({ page, baseURL }) => {
  const diagnostics = await open(page, baseURL); await selectVoice(page, 'lead');
  const initial = await capture(page);
  await expect(page.locator('[data-editor-knob="pan"], [data-editor-knob="center"]')).toHaveCount(0);
  await expect(page.locator('#sequencePageControls')).toBeHidden();
  await expect(xScroll(page)).toBeHidden(); await expect(yScroll(page)).toBeVisible();
  await zoom(page).press('ArrowLeft'); await expect(xScroll(page)).toHaveAttribute('aria-valuemax', '1');
  await zoom(page).press('Home'); await expect(xScroll(page)).toHaveAttribute('aria-valuemax', '3');
  await pitchView(page).press('End'); await expect(yScroll(page)).toBeHidden();
  await pitchView(page).press('Home'); await expect(yScroll(page)).toHaveAttribute('aria-valuemax', '120');
  await xScroll(page).press('Home'); await xScroll(page).hover(); await page.mouse.wheel(0, 120);
  await expect(xScroll(page)).toHaveAttribute('aria-valuenow', '1'); await expectPage(page, '09–16');
  const previousY = Number(await yScroll(page).getAttribute('aria-valuenow'));
  await yScroll(page).hover(); await page.mouse.wheel(0, 120);
  await expect(yScroll(page)).toHaveAttribute('aria-valuenow', String(previousY + 1));
  for (const voice of pitched) { await selectVoice(page, voice); await expect(yScroll(page)).toBeVisible(); await expect(pitchView(page)).toBeVisible(); }
  for (const voice of ['arp', 'drums']) {
    await selectVoice(page, voice); await expect(yScroll(page)).toBeHidden();
    await expect(pitchView(page)).toBeHidden(); await expect(xScroll(page)).toBeVisible();
  }
  await selectVoice(page, 'noise'); await expect(xScroll(page)).toBeHidden(); await expect(yScroll(page)).toBeHidden();
  await selectVoice(page, 'lead'); await zoom(page).press('End'); await expect(xScroll(page)).toBeHidden();
  expect(await capture(page)).toEqual(initial);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('Arp keeps its 0–1 contour and separate step volume after horizontal scrolling', async ({ page, baseURL }) => {
  const diagnostics = await open(page, baseURL); await selectVoice(page, 'arp'); await zoom(page).press('Home');
  await xScroll(page).press('ArrowRight'); await expectPage(page, '09–16');
  await expect(yScroll(page)).toBeHidden(); await expect(pitchView(page)).toBeHidden();
  const before = await capture(page), grid = await rollGrid(page);
  await stroke(page, ...await grid.reveal(grid.pitch(2, .2), grid.pitch(2, .8)));
  const painted = await capture(page);
  expect(painted.sequence.lanes.arp.cells[10].value).toBeCloseTo(.8, 1);
  expect(painted.parameters).toEqual(before.parameters);
  await stroke(page, ...await grid.reveal(grid.volume(2, .9), grid.volume(2, .3)));
  const quieter = await capture(page);
  expect(quieter.sequence.lanes.arp.cells[10].value).toBe(painted.sequence.lanes.arp.cells[10].value);
  expect(quieter.sequence.lanes.arp.cells[10].velocity).toBeCloseTo(.3, 1);
  for (const [lane, value] of Object.entries(before.sequence.lanes)) if (lane !== 'arp') expect(quieter.sequence.lanes[lane]).toEqual(value);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('manual scroll stops Follow from taking the view back and preserves the running audio clock', async ({ page, baseURL }) => {
  const diagnostics = await open(page, baseURL); await selectVoice(page, 'lead'); await zoom(page).press('Home');
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import('./src/instruments/simd-chiptune/audio.js');
    const start = SimdChiptuneAudio.prototype.start; globalThis.__rollStarts = 0;
    SimdChiptuneAudio.prototype.start = function (...args) { globalThis.__rollEngine = this; globalThis.__rollStarts++; return start.apply(this, args); };
  });
  await page.locator('#audioButton').click(); await page.locator('#synthPlayButton').click(); await waitForStableAudioState(page, true);
  const clock = () => page.evaluate(() => ({ starts: __rollStarts, anchor: __rollEngine.timelineStart,
    beat: __rollEngine.currentPlaybackBeat(), running: __rollEngine.running, context: __rollEngine.context.state }));
  const before = await clock(), initial = await capture(page);
  await page.locator('#sequenceFollow').click(); await expect(page.locator('#sequenceFollow')).toHaveAttribute('aria-pressed', 'true');
  await xScroll(page).press('End'); await expect(page.locator('#sequenceFollow')).toHaveAttribute('aria-pressed', 'false');
  await yScroll(page).press('End'); await page.waitForTimeout(900);
  await expect(xScroll(page)).toHaveAttribute('aria-valuenow', '3'); await expectPage(page, '25–32');
  expect(await capture(page)).toEqual(initial);
  const after = await clock(); expect(after.starts).toBe(before.starts); expect(after.anchor).toBe(before.anchor);
  expect(after.beat).toBeGreaterThan(before.beat); expect(after.running).toBe(true); expect(after.context).toBe('running');
  const audio = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(audio.summary.finite).toBe(true); expect(audio.summary.maxRms).toBeGreaterThan(.00001); expect(audio.summary.clippedSamples).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', 'true');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('voice timing and clarified spread knobs change their state only in applicable modes', async ({ page, baseURL }) => {
  const diagnostics = await open(page, baseURL);
  // The broader live-deck suite already checks every voice; Arp exercises the
  // timing controls alongside the clarified contour and stereo parameters.
  for (const voice of ['arp']) {
    await page.locator(`[data-voice-view="${voice}"]`).click();
    const rhythm = page.locator(`[data-sequence-lane="${voice}"]`);
    const length = rhythm.locator('[data-sequence-param="Note length"] [role="slider"]');
    const time = rhythm.locator('[data-sequence-param="Step time"] [role="slider"]');
    await expect(length).toHaveAccessibleName('Note length'); await expect(time).toHaveAccessibleName('Step time');
    await expect(rhythm.locator('[data-sequence-param="Note length"]')).toHaveAttribute('title', /each step.*Step time/);
    const before = await capture(page); await length.press('Home');
    expect((await capture(page)).sequence.lanes[voice].gate).toBe(.05);
    await length.press('End'); await time.press('ArrowRight'); const changed = await capture(page);
    expect(changed.sequence.lanes[voice].gate).toBe(1);
    expect(changed.sequence.lanes[voice].stepBeats).toBeGreaterThan(before.sequence.lanes[voice].stepBeats);
    expect(changed.sequence.lanes[voice].cells).toEqual(before.sequence.lanes[voice].cells);
    expect(changed.parameters).toEqual(before.parameters);
    for (const [lane, value] of Object.entries(before.sequence.lanes)) if (lane !== voice) expect(changed.sequence.lanes[lane]).toEqual(value);
  }
  for (const mode of ['song', 'pattern']) {
    await page.locator('#compositionMode').selectOption(mode);
    for (const voice of ['arp']) {
      const controls = page.locator(`[data-sequence-lane="${voice}"] [data-sequence-param="Note length"], [data-sequence-lane="${voice}"] [data-sequence-param="Step time"]`);
      for (const control of await controls.all()) { if (mode === 'song') await expect(control).toBeHidden(); else await expect(control).toBeVisible(); }
    }
    const arp = page.locator('[data-param-key="arpSpan"]'); await expect(arp).toHaveAccessibleName('Pitch spread');
    const beforeArp = await capture(page); await arp.press('ArrowRight'); const afterArp = await capture(page);
    expect(afterArp.parameters.arpSpan).toBeGreaterThan(beforeArp.parameters.arpSpan); expect(afterArp.sequence).toEqual(beforeArp.sequence);
    await page.locator('#tab-globalMix').click(); const width = page.locator('[data-param-key="stereoWidth"]');
    await expect(width).toHaveAccessibleName('Stereo spread'); const beforeWidth = await capture(page);
    await width.press('ArrowLeft'); const afterWidth = await capture(page);
    expect(afterWidth.parameters.stereoWidth).toBeLessThan(beforeWidth.parameters.stereoWidth); expect(afterWidth.sequence).toEqual(beforeWidth.sequence);
  }
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
