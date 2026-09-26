import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { observeAutomataState } from './helpers/automatapoeia-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const keys = ['caAttack', 'caDecay', 'caSustain', 'caRelease'];
const handle = (page, key) => page.locator(`[data-envelope="${key}"]`);
const snapshot = page => page.evaluate(() => __caSnapshot());
async function recall(page, id) {
  const picker = page.locator('.header-preset-picker');
  if (!await picker.evaluate(node => node.open)) await picker.locator('summary').click();
  await picker.locator(`[data-preset-id="${id}"]`).click();
}
async function synchronized(page) {
  const state = await snapshot(page);
  for (const key of keys) {
    const value = Number(await page.locator(`#${key}`).inputValue());
    const step = Number(await page.locator(`#${key}`).getAttribute('step'));
    // Native ranges round preset/random values to a step; the graph and readout
    // must still show the authoritative, unquantized parameter value.
    expect(Math.abs(value - state.parameters[key])).toBeLessThanOrEqual(step / 2 + 1e-9);
    await expect(handle(page, key)).toHaveAttribute('aria-valuenow', String(Math.round(state.parameters[key] * (key === 'caSustain' ? 100 : 1000))));
  }
}

for (const [width, height] of [[1440,900], [390,844], [844,390], [320,740]]) {
  test(`Rules, Shape sections, ADSR and MIDI monitor remain reachable at ${width}x${height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport:{width,height}, isMobile:width<1000, hasTouch:width<1000 });
    const page = await context.newPage();
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    try {
      await page.goto('./automatapoeia.html');
      await expect(page.locator('#caRulePicker > summary')).toContainText('Rules');
      expect(await page.locator('#caRulePicker').evaluate(node => node.previousElementSibling.contains(document.querySelector('#randomizeAutomata')))).toBe(true);
      await expect(page.locator('.instrument-page-info, #caEvolutionSummary, #caRunSummary, #automataInterestTitle, #nksOpenProblemsTitle')).toHaveCount(0);
      expect(await page.locator('.experiment-panel > details.group > .group-summary').count()).toBe(4);
      for (const key of keys) {
        await expect(page.locator(`#${key}`)).toBeHidden();
        const node = handle(page, key);
        await node.scrollIntoViewIfNeeded();
        await expect(node).toBeVisible();
        const rect = await node.boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height);
        // At least a 32px non-transport touch target, plus keyboard support.
        if (width < 1000) expect(rect.width).toBeGreaterThanOrEqual(32);
      }
      const monitor = page.locator('#midiOutputMonitor');
      await monitor.scrollIntoViewIfNeeded();
      await expect(monitor).toBeVisible();
      await expect(monitor).toContainText('MIDI OUT MONITOR');
      for (const kind of ['note','control','timing','transport']) await expect(monitor.locator(`[data-kind="${kind}"]`)).toBeVisible();
      await expect(monitor).toContainText('NO MIDI IS SENT');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator('.experiment-panel').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test('graph edits keep native ADSR, presets, MIDI preview and transport synchronized', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await observeAutomataState(page);
  await page.goto('./automatapoeia.html');
  const before = await snapshot(page);
  for (const key of keys) {
    const node = handle(page, key);
    await node.scrollIntoViewIfNeeded();
    await node.press('End');
    expect((await snapshot(page)).parameters[key]).toBe(Number(await page.locator(`#${key}`).getAttribute('max')));
    await node.press('Home');
    expect((await snapshot(page)).parameters[key]).toBe(Number(await page.locator(`#${key}`).getAttribute('min')));
    await node.press('ArrowRight');
    await synchronized(page);
    await expect(page.locator('#midiOutputMonitor [data-kind="control"]')).toContainText(key.slice(2));
  }
  const after = await snapshot(page);
  expect(after.rows).toEqual(before.rows);
  expect(after.initial).toEqual(before.initial);
  expect(after.parameters.caRule).toBe(before.parameters.caRule);
  expect(after.playing).toBe(false);
  expect(after.audioOn).toBe(false);
  expect(after.contextCount).toBe(0);

  await recall(page, 'fast-60');
  await expect(handle(page, 'caAttack')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#caStrikeLength')).toHaveValue('0.65');
  await expect(page.locator('#caAttackOut')).toHaveText('2 ms');
  await synchronized(page);
  const path = await page.locator('#caEnvelopePath').getAttribute('d');
  await page.locator('.header-preset-random').click();
  await synchronized(page);
  expect(await page.locator('#caEnvelopePath').getAttribute('d')).not.toBe(path);
  // The existing global reset reloads the page; wait for its new controller.
  await Promise.all([page.waitForEvent('load'), page.locator('[data-reset-all]').click()]);
  await page.waitForFunction(() => typeof __caSnapshot === 'function');
  await synchronized(page);
  await expect(handle(page, 'caAttack')).toHaveAttribute('aria-valuenow', '12');
  expect((await snapshot(page)).contextCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('dragging each envelope stage during playback preserves the running audio clock', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await observeAutomataState(page);
  await page.goto('./automatapoeia.html');
  await recall(page, 'fast-60');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(4);
  const before = await snapshot(page);
  const envelope = await sampleAudioEnvelope(page, { durationMs:1100 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.meanRms).toBeGreaterThan(.001);
  for (const key of keys) {
    const node = handle(page, key);
    await node.scrollIntoViewIfNeeded();
    const rect = await node.boundingBox();
    const start = Number(await page.locator(`#${key}`).inputValue());
    await page.mouse.move(rect.x+rect.width/2, rect.y+rect.height/2);
    await page.mouse.down();
    await page.mouse.move(rect.x+rect.width/2+(key === 'caSustain' ? 0 : 8), rect.y+rect.height/2+(key === 'caSustain' ? 12 : 0), { steps:4 });
    await page.mouse.up();
    expect(Number(await page.locator(`#${key}`).inputValue())).not.toBe(start);
    await synchronized(page);
  }
  const after = await snapshot(page);
  expect(after.playing).toBe(true);
  expect(after.audioOn).toBe(true);
  expect(after.contextCount).toBe(1);
  expect(after.contextTime).toBeGreaterThan(before.contextTime);
  expect(after.generation).toBeGreaterThan(before.generation);
  expect(after.initial).toEqual(before.initial);
  expect(after.rows.slice(0, before.rows.length)).toEqual(before.rows);
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('ADSR capture cancels cleanly and destroy removes its keyboard/pointer listeners', async ({ page }) => {
  // Real authored DOM/CSS and controller, without the app/audio lifecycle.
  const html = (await readFile(new URL('../automatapoeia.html', import.meta.url), 'utf8'))
    .replace(/<script\b[\s\S]*?<\/script>/g, '');
  await page.route('**/automatapoeia.html', route => route.fulfill({ contentType:'text/html', body:html }));
  await page.goto('./automatapoeia.html');
  await page.evaluate(async () => {
    const { mountAutomatapoeiaEnvelope } = await import('./src/instruments/cellular-automata/automatapoeia-envelope.js');
    globalThis.__envelope = mountAutomatapoeiaEnvelope(document.querySelector('#caEnvelopeControl'));
  });
  const node = handle(page, 'caAttack');
  await node.scrollIntoViewIfNeeded();
  for (const action of ['pointercancel', 'lostpointercapture', 'blur', 'destroy']) {
    const rect = await node.boundingBox();
    await page.mouse.move(rect.x+rect.width/2, rect.y+rect.height/2);
    await page.mouse.down();
    // Activate pending capture before exercising a real capture loss.
    await page.mouse.move(rect.x+rect.width/2, rect.y+rect.height/2);
    const original = await page.locator('#caAttack').inputValue();
    await page.evaluate(action => {
      const editor = document.querySelector('#caEnvelopeEditor');
      if (action === 'blur') window.dispatchEvent(new Event('blur'));
      else if (action === 'destroy') __envelope.destroy();
      else if (action === 'lostpointercapture') editor.releasePointerCapture(1);
      else editor.dispatchEvent(new PointerEvent(action, { pointerId:1, bubbles:true }));
    }, action);
    await page.mouse.move(rect.x+rect.width/2+30, rect.y+rect.height/2);
    await page.mouse.up();
    await expect(page.locator('#caAttack')).toHaveValue(original);
  }
  await node.press('End');
  await expect(page.locator('#caAttack')).toHaveValue('0.012');
});

test('phone touch edits sustain without scrolling, while the surrounding panel still scrolls', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  try {
    const page = await context.newPage();
    await observeAutomataState(page);
    await page.goto('./automatapoeia.html');
    const node = handle(page, 'caSustain');
    await node.scrollIntoViewIfNeeded();
    const rect = await node.boundingBox();
    const client = await context.newCDPSession(page);
    const touch = (type, x, y) => client.send('Input.dispatchTouchEvent', {
      type, touchPoints:type === 'touchEnd' || type === 'touchCancel' ? [] : [{x,y}],
    });
    const panel = page.locator('.experiment-panel');
    const scroll = await panel.evaluate(node => node.scrollTop);
    const start = (await snapshot(page)).parameters.caSustain;
    const x = rect.x+rect.width/2, y = rect.y+rect.height/2;
    await touch('touchStart', x, y);
    await touch('touchMove', x, y-20);
    await touch('touchEnd');
    await expect.poll(async () => (await snapshot(page)).parameters.caSustain).toBeGreaterThan(start);
    expect(await panel.evaluate(node => node.scrollTop)).toBe(scroll);
    await synchronized(page);
    await expect(page.locator('#midiOutputMonitor [data-kind="control"]')).toContainText('Sustain');
    // A swipe outside the editor still belongs to the native panel scroller.
    await touch('touchStart', 8, 740);
    for (const y of [710,680,650,620]) await touch('touchMove', 8, y);
    await touch('touchEnd');
    await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBeGreaterThan(scroll);
    expect((await snapshot(page)).audioOn).toBe(false);
  } finally { await context.close(); }
});
