import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => window.__puggler.snapshot());
const range = (page, id, value) => page.locator(`#${id}`).evaluate((element, next) => {
  element.value = String(next);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

async function openShow(page) {
  await page.goto('puggler.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.__puggler))).toBe(true);
}

async function releaseAndSettle(page, keys) {
  for (const key of keys) await page.keyboard.up(key);
  await page.waitForTimeout(650);
}

test('Puggler starts a silent six-object trio verse with automatic passing', async ({ page }) => {
  await openShow(page);
  expect(await state(page)).toMatchObject({
    count: 6, pattern: 'many-6', partner: 'trio-auto', phrase: 'verse',
    tempo: 360, loft: 1.8, chaos: 40, riders: 3, selectedPlayer: 0, running: true, audioOn: false,
  });
  await expect(page.locator('#pattern')).toBeDisabled();
  await expect(page.locator('#passMode')).toBeEnabled();
  await expect(page.locator('#playerPicker')).toBeVisible();
  await expect(page.locator('#objectControls .object-card')).toHaveCount(6);
  await expect(page.locator('#phraseSteps span')).toHaveCount(16);
  await expect.poll(async () => (await state(page)).passes).toBeGreaterThan(1);
  await expect.poll(async () => (await state(page)).catches).toBeGreaterThan(1);
  const silent = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 });
  expect(silent.summary.maxPeak).toBeLessThan(.001);
  expect((await state(page)).audioOn).toBe(false);
});

test('Puggler separates explicit Audio, output level, mute, pause, and teardown', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openShow(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  const sound = await sampleAudioEnvelope(page, { durationMs: 1400, intervalMs: 50 });
  expect(sound.summary.finite).toBe(true);
  expect(sound.summary.maxPeak).toBeGreaterThan(.003);
  expect(sound.summary.clippedSamples).toBe(0);
  const beforePosters = await state(page);
  await page.locator('#postersButton').click();
  const afterPosters = await state(page);
  expect(afterPosters.posterSeed).not.toBe(beforePosters.posterSeed);
  expect(afterPosters.time).toBeGreaterThanOrEqual(beforePosters.time);
  expect(afterPosters).toMatchObject({ running: true, audioOn: true });
  await range(page, 'level', 0);
  const quiet = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
  expect(quiet.samples.at(-1).peak).toBeLessThan(.001);
  await range(page, 'level', .35);
  await page.locator('#playButton').click();
  const pausedTime = (await state(page)).time;
  await page.waitForTimeout(300);
  expect((await state(page)).time).toBe(pausedTime);
  expect((await state(page)).audioOn).toBe(true);
  const stopped = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
  expect(stopped.summary.maxPeak).toBeLessThan(.001);
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  expect(await state(page)).toMatchObject({ running: true, audioOn: false });
  const mutedTime = (await state(page)).time;
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(mutedTime);
  const muted = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
  expect(muted.samples.at(-1).peak).toBeLessThan(.001);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  expect(await state(page)).toMatchObject({ disposed: true, attacks: 0 });
  const disposedTime = (await state(page)).time;
  await page.waitForTimeout(200);
  expect((await state(page)).time).toBe(disposedTime);
  expect(errors).toEqual([]);
});

test('WASD, fast riding, rider selection, and individual throw height work together', async ({ page }) => {
  await openShow(page);
  await page.locator('#partner').selectOption('solo');
  await range(page, 'chaos', 0);
  await page.locator('#stage').focus();
  await page.keyboard.down('d');
  await page.waitForTimeout(280);
  const slowSpeed = (await state(page)).players[0].vx;
  expect(slowSpeed).toBeGreaterThan(80);
  await releaseAndSettle(page, ['d']);
  await page.keyboard.down('e');
  await page.waitForTimeout(280);
  const fastSpeed = (await state(page)).players[0].vx;
  expect(fastSpeed).toBeGreaterThan(slowSpeed * 1.8);
  await releaseAndSettle(page, ['e']);
  const originalHeight = (await state(page)).players[0].loft;
  await page.keyboard.down('w');
  await expect.poll(async () => (await state(page)).players[0].loft).toBeGreaterThan(originalHeight + .1);
  await page.keyboard.up('w');
  const raised = (await state(page)).players[0].loft;
  await page.keyboard.down('s');
  await expect.poll(async () => (await state(page)).players[0].loft).toBeLessThan(raised - .1);
  await page.keyboard.up('s');
  await page.locator('#partner').selectOption('trio-manual');
  await page.locator('#stage').focus();
  const beforeSelection = (await state(page)).players;
  await page.keyboard.press('3');
  expect((await state(page)).selectedPlayer).toBe(2);
  await expect(page.locator('#playerPicker')).toHaveValue('2');
  await page.keyboard.down('e');
  await expect.poll(async () => (await state(page)).players[2].x).toBeGreaterThan(beforeSelection[2].x + 45);
  expect(Math.abs((await state(page)).players[0].x - beforeSelection[0].x)).toBeLessThan(1);
  await releaseAndSettle(page, ['e']);
  await page.keyboard.press('2');
  await page.keyboard.down('a');
  await expect.poll(async () => (await state(page)).players[1].x).toBeLessThan(beforeSelection[1].x - 35);
  await releaseAndSettle(page, ['a']);
  await page.keyboard.press('1');
  expect(await state(page)).toMatchObject({ selectedPlayer: 0, running: true, audioOn: false });
});

test('Roxy and Moss physical keyboard clusters steer and shape their own throws', async ({ page }) => {
  await openShow(page);
  await page.locator('#partner').selectOption('trio-manual');
  await range(page, 'chaos', 0);
  await page.locator('#stage').focus();
  const initial = (await state(page)).players;
  for (const key of ['d', 'l', 'Numpad4']) await page.keyboard.down(key);
  await expect.poll(async () => {
    const p = (await state(page)).players;
    return p[0].x > initial[0].x + 25 && p[1].x > initial[1].x + 25 && p[2].x < initial[2].x - 25;
  }).toBe(true);
  await releaseAndSettle(page, ['d', 'l', 'Numpad4']);
  const settled = (await state(page)).players;
  for (const key of ['u', 'Numpad9']) await page.keyboard.down(key);
  await page.waitForTimeout(250);
  const fast = (await state(page)).players;
  expect(fast[1].vx).toBeLessThan(-200);
  expect(fast[2].vx).toBeGreaterThan(200);
  expect(Math.abs(fast[0].x - settled[0].x)).toBeLessThan(2);
  await releaseAndSettle(page, ['u', 'Numpad9']);
  const loft = (await state(page)).players.map(player => player.loft);
  await page.keyboard.down('i');
  await page.keyboard.down('Numpad8');
  await expect.poll(async () => {
    const p = (await state(page)).players;
    return p[1].loft > loft[1] + .1 && p[2].loft > loft[2] + .1;
  }).toBe(true);
  await page.keyboard.up('i');
  await page.keyboard.up('Numpad8');
  expect((await state(page)).players[0].loft).toBe(loft[0]);
  for (const key of ['f', 'h', 'Numpad5']) await page.keyboard.press(key);
  const kicked = await state(page);
  for (const player of kicked.players) expect(player.lastKick).toBeGreaterThan(0);
  expect(kicked.audioOn).toBe(false);
});

test('throwing to the audience returns a different sound object on a rising arc', async ({ page }) => {
  await openShow(page);
  await page.locator('#partner').selectOption('solo');
  await page.locator('#count').selectOption('1');
  await page.locator('#phrase').selectOption('loop');
  await page.locator('#pattern').selectOption('single');
  await range(page, 'chaos', 0);
  await range(page, 'assist', 120);
  await page.locator('#stage').focus();
  const before = await state(page);
  await page.keyboard.press('g');
  await expect.poll(async () => (await state(page)).objects.some(object => object.phase === 'audience')).toBe(true);
  const outward = (await state(page)).objects[0];
  expect((await state(page)).players[0].lastCrowdThrow).toBeGreaterThanOrEqual(before.time);
  await expect.poll(async () => (await state(page)).crowdCatches).toBeGreaterThan(before.crowdCatches);
  await expect.poll(async () => {
    const object = (await state(page)).objects[0];
    return object.phase === 'replacement' && object.vy > 0 && object.prop !== outward.prop;
  }).toBe(true);
  const replacement = (await state(page)).objects[0];
  expect(replacement).toMatchObject({ id: outward.id, drum: outward.drum, riff: outward.riff, owner: 0 });
  await expect(page.locator('#object0')).toHaveValue(replacement.prop);
  const catchesBeforeReturn = (await state(page)).catches;
  await expect.poll(async () => (await state(page)).catches).toBeGreaterThan(catchesBeforeReturn);
  const beforeButton = (await state(page)).crowdCatches;
  await page.locator('#crowdButton').click();
  await expect.poll(async () => (await state(page)).crowdCatches).toBeGreaterThan(beforeButton);
  expect(await state(page)).toMatchObject({ count: 1, running: true, audioOn: false });
});

test('ten live objects keep their drum and riff edits across phrase and speed changes', async ({ page }) => {
  await openShow(page);
  await range(page, 'chaos', 0);
  await page.locator('#count').selectOption('10');
  await expect(page.locator('#objectControls .object-card')).toHaveCount(10);
  const before = (await state(page)).time;
  await page.locator('#object9').selectOption('plushrat');
  await page.locator('#drums9').selectOption('snare');
  await page.locator('#riffs9').selectOption('woo');
  await page.locator('#object0').selectOption('mic');
  await page.locator('#drums0').selectOption('crash');
  await page.locator('#riffs0').selectOption('oi');
  const edited = await state(page);
  expect(edited.objects[9]).toMatchObject({ prop: 'plushrat', drum: 'snare', riff: 'woo' });
  expect(edited.objects[0]).toMatchObject({ prop: 'mic', drum: 'crash', riff: 'oi' });
  expect(edited.time).toBeGreaterThan(before);
  expect(edited).toMatchObject({ running: true, audioOn: false });
  const available = await page.locator('#object9 option').evaluateAll(options => options.map(option => option.value));
  for (const id of ['guitar', 'cassette', 'skateboard', 'vinyl', 'mic', 'cone', 'glowstick', 'mushroom', 'plushrat']) expect(available).toContain(id);
  await page.locator('#phrase').selectOption('loop');
  await expect(page.locator('#pattern')).toBeEnabled();
  await page.locator('#pattern').selectOption('shower-10');
  expect(await state(page)).toMatchObject({ phrase: 'loop', pattern: 'shower-10' });
  await range(page, 'tempo', 1200);
  await range(page, 'loft', 3);
  expect(await state(page)).toMatchObject({ tempo: 1200, loft: 3, running: true });
  await expect.poll(async () => Math.max(...(await state(page)).objects.map(object => object.y))).toBeGreaterThan(1500);
  const fast = await state(page);
  for (const object of fast.objects) for (const key of ['x', 'y', 'vx', 'vy']) expect(Number.isFinite(object[key])).toBe(true);
  await page.locator('#phrase').selectOption('evolve');
  await expect(page.locator('#pattern')).toBeDisabled();
  await page.locator('#count').selectOption('5');
  await expect(page.locator('#objectControls .object-card')).toHaveCount(5);
  expect(await state(page)).toMatchObject({ count: 5, phrase: 'evolve', running: true, audioOn: false });
  await page.locator('#stage').focus();
  await page.keyboard.press('Space');
  expect((await state(page)).running).toBe(false);
  await page.keyboard.press('Space');
  expect((await state(page)).running).toBe(true);
  await page.locator('#resetButton').click();
  expect(await state(page)).toMatchObject({ count: 6, pattern: 'many-6', partner: 'trio-auto', phrase: 'verse', tempo: 360, loft: 1.8, chaos: 40, audioOn: false });
  expect((await state(page)).objects[0]).toMatchObject({ drum: 'kick', riff: 'guitar' });
  await expect(page.locator('#pattern')).toBeDisabled();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Puggler fits ${viewport.width} × ${viewport.height} and keeps controls reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openShow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.puggler-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
    await expect(page.locator('#pageTitle')).toBeVisible();
    expect(await page.locator('.puggler-playbar').evaluate(bar => bar.scrollWidth <= bar.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`puggler-default-${viewport.width}.png`), fullPage: false });
    await page.locator('.puggler-stage-wrap').screenshot({ path: testInfo.outputPath(`puggler-stage-${viewport.width}.png`) });
    await page.locator('#preset').selectOption('float');
    await expect(page.locator('#playerPicker')).toBeVisible();
    await page.locator('#riffs1').selectOption('bass');
    await page.locator('#playerPicker').selectOption('1');
    await page.locator('#higherButton').focus();
    const loftBefore = (await state(page)).players[1].loft;
    await page.keyboard.down('Enter');
    await expect.poll(async () => (await state(page)).players[1].loft).toBeGreaterThan(loftBefore + .1);
    await page.keyboard.up('Enter');
    await page.locator('.puggler-playbar').screenshot({ path: testInfo.outputPath(`puggler-controls-${viewport.width}.png`) });
    await page.locator('#randomButton').click();
    await page.locator('#resetButton').click();
    await page.locator('#partner').selectOption('solo');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const box = await page.locator('#stage').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(400);
    const start = (await state(page)).x;
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .8, box.y + box.height * .5);
    await expect.poll(async () => (await state(page)).x).toBeGreaterThan(start + 60);
    await page.mouse.up();
    expect((await state(page)).audioOn).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`puggler-${viewport.width}.png`), fullPage: false });
  });
}

test('touch dragging and cancellation release solo steering without arming Audio', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await openShow(page);
    await page.locator('#partner').selectOption('solo');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page), box = await page.locator('#stage').boundingBox();
    const before = (await state(page)).x;
    const point = { x: box.x + box.width * .78, y: box.y + box.height * .6, id: 1 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect.poll(async () => (await state(page)).x).toBeGreaterThan(before + 90);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(800);
    const stopped = (await state(page)).x;
    await page.waitForTimeout(300);
    expect(Math.abs((await state(page)).x - stopped)).toBeLessThan(2);
    expect((await state(page)).audioOn).toBe(false);
    for (const id of ['audioButton', 'playButton', 'crowdButton', 'higherButton', 'fastLeftButton']) {
      const size = await page.locator(`#${id}`).boundingBox();
      expect(size.width).toBeGreaterThanOrEqual(48);
      expect(size.height).toBeGreaterThanOrEqual(48);
    }
  } finally {
    await context.close();
  }
});

test('three touches steer every manual rider independently and cancellation releases all', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await openShow(page);
    await page.locator('#partner').selectOption('trio-manual');
    await range(page, 'chaos', 0);
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page), box = await page.locator('#stage').boundingBox();
    const initial = (await state(page)).players;
    const touches = [.15, .44, .87].map((x, i) => ({ x: box.x + box.width * x, y: box.y + box.height * .65, id: i + 11 }));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
    await expect.poll(async () => {
      const p = (await state(page)).players;
      return p[0].x < initial[0].x - 25 && p[1].x < initial[1].x - 25 && p[2].x > initial[2].x + 25;
    }).toBe(true);
    const spread = (await state(page)).players;
    [.27, .56, .73].forEach((x, i) => { touches[i].x = box.x + box.width * x; });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches });
    await expect.poll(async () => {
      const p = (await state(page)).players;
      return p[0].x > spread[0].x + 35 && p[1].x > spread[1].x + 35 && p[2].x < spread[2].x - 35;
    }).toBe(true);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(800);
    const stopped = (await state(page)).players;
    await page.waitForTimeout(300);
    const after = await state(page);
    for (let i = 0; i < 3; i++) expect(Math.abs(after.players[i].x - stopped[i].x)).toBeLessThan(2);
    expect(after).toMatchObject({ riders: 3, partner: 'trio-manual', running: true, audioOn: false });
  } finally {
    await context.close();
  }
});

test('automatic Roxy and Moss yield to direct touch while Audio stays off', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await openShow(page);
    await range(page, 'chaos', 0);
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page), box = await page.locator('#stage').boundingBox();
    const initial = (await state(page)).players;
    const touches = [.59, .7].map((x, i) => ({ x: box.x + box.width * x, y: box.y + box.height * .6, id: i + 21 }));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
    await expect.poll(async () => {
      const p = (await state(page)).players;
      return p[1].x > initial[1].x + 35 && p[2].x < initial[2].x - 35;
    }).toBe(true);
    expect(Math.abs((await state(page)).players[0].x - initial[0].x)).toBeLessThan(2);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await state(page)).toMatchObject({ partner: 'trio-auto', running: true, audioOn: false });
  } finally {
    await context.close();
  }
});
