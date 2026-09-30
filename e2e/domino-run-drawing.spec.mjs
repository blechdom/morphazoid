import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  await expect(page.locator('#sceneName')).toHaveText('Tone Henge');
}
const snapshot = page => page.evaluate(() => window.dominoRun.snapshot);
const runState = page => page.evaluate(() => window.dominoRun.run);
async function enterDraw(page) {
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await expect(page.locator('#drawTools')).toBeVisible();
  await page.locator('#stage').scrollIntoViewIfNeeded();
}
async function stroke(page, points) {
  const box = await page.locator('#stage').boundingBox();
  const screen = points.map(([x, y]) => ({ x: box.x + box.width * x, y: box.y + box.height * y }));
  await page.mouse.move(screen[0].x, screen[0].y);
  await page.mouse.down();
  for (const point of screen.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
}
const curve = (y = .5) => Array.from({ length: 33 }, (_, i) => {
  const t = i / 32;
  return [.18 + .62 * t, y + .09 * Math.sin(t * Math.PI * 2)];
});
const ring = () => Array.from({ length: 65 }, (_, i) => {
  const a = i / 64 * Math.PI * 2;
  return [.5 + .26 * Math.cos(a), .54 + .20 * Math.sin(a)];
});
async function keyboardPath(page) {
  await page.locator('#stage').focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#finishPath')).toBeEnabled();
  await page.keyboard.press('Shift+Enter');
}

test('mouse curves create independent chains and one Undo reverses each entire stroke', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const factory = await snapshot(page);
  await enterDraw(page);
  await stroke(page, curve());
  const first = await snapshot(page), firstRun = await runState(page);
  expect(first.drawing.strokes).toHaveLength(1);
  expect(first.drawing.strokes[0].points.length).toBeGreaterThan(12);
  expect(firstRun.dominoes.length).toBeGreaterThan(12);
  expect(firstRun.roots).toEqual([0]);
  expect(firstRun.strokeRanges[0].closed).toBe(false);
  expect(new Set(firstRun.dominoes.map(d => d.z.toFixed(3))).size).toBeGreaterThan(5);
  await expect(page.locator('#sceneName')).toHaveText('Drawn pattern');
  await expect(page.locator('#layout')).toHaveValue('drawn');
  await expect(page.locator('#count')).toBeHidden();

  await stroke(page, curve(.70));
  const second = await snapshot(page), secondRun = await runState(page);
  expect(second.drawing.strokes).toHaveLength(2);
  expect(second.drawing.strokes[0]).toEqual(first.drawing.strokes[0]);
  expect(secondRun.roots).toHaveLength(2);
  const boundary = secondRun.roots[1];
  expect(boundary).toBe(firstRun.dominoes.length);
  expect(secondRun.links.every(link => (link.from < boundary) === (link.to < boundary))).toBe(true);
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  const firstRoot = await page.evaluate(() => window.dominoRun.targets.find(tile => tile.id === 0));
  await page.locator('#stage').click({ position: { x: firstRoot.x, y: firstRoot.y } });
  expect(await page.evaluate(() => window.dominoRun.playing)).toBe(true);
  expect(await page.evaluate(() => window.dominoRun.timeline.falls.every(fall => fall.id < window.dominoRun.run.roots[1]))).toBe(true);
  expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);

  await enterDraw(page);
  await page.locator('#undoDraw').click();
  expect(await snapshot(page)).toEqual(first);
  expect((await runState(page)).roots).toHaveLength(1);
  await page.locator('#undoDraw').click();
  expect(await snapshot(page)).toEqual(factory);
  await expect(page.locator('#sceneName')).toHaveText('Tone Henge');
  await expect(page.locator('#undoDraw')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('keyboard points build a path, Escape discards drafts, and Undo restores the factory run', async ({ page }) => {
  await open(page);
  const factory = await snapshot(page);
  await enterDraw(page);
  await keyboardPath(page);
  const authored = await snapshot(page), run = await runState(page);
  expect(authored.drawing.strokes).toHaveLength(1);
  expect(authored.drawing.strokes[0].points).toHaveLength(3);
  const [start, corner, end] = authored.drawing.strokes[0].points;
  expect(corner.x).toBeGreaterThan(start.x);
  expect(corner.z).toBe(start.z);
  expect(end.z).toBeGreaterThan(corner.z);
  expect(end.x).toBe(corner.x);
  expect(run.dominoes.length).toBeGreaterThan(8);
  await expect(page.locator('#finishPath')).toBeDisabled();
  expect(await page.evaluate(() => window.dominoRun.playing)).toBe(false);
  expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#finishPath')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#finishPath')).toBeDisabled();
  expect(await snapshot(page)).toEqual(authored);
  await page.keyboard.press('Control+z');
  expect(await snapshot(page)).toEqual(factory);
});

test('Close loops joins a near-ended drawn ring and can leave the same gesture open', async ({ page }) => {
  await open(page);
  await enterDraw(page);
  await expect(page.locator('#closeLoops')).toBeChecked();
  await stroke(page, ring());
  const closed = await runState(page);
  expect(closed.strokeRanges[0].closed).toBe(true);
  expect(closed.links.at(-1)).toEqual({ from: closed.dominoes.length - 1, to: 0 });
  expect(closed.links).toHaveLength(closed.dominoes.length);
  expect(Math.hypot(closed.dominoes.at(-1).x - closed.dominoes[0].x,
    closed.dominoes.at(-1).z - closed.dominoes[0].z)).toBeGreaterThan(.01);
  await page.locator('#undoDraw').click();
  await page.locator('#closeLoops').uncheck();
  await stroke(page, ring());
  const openRing = await runState(page);
  expect(openRing.strokeRanges[0].closed).toBe(false);
  expect(openRing.links).toHaveLength(openRing.dominoes.length - 1);
  expect(openRing.links.some(link => link.to === 0)).toBe(false);
});

test('complete toolbar capture includes drawing; presets and both randomizers replace it', async ({ page }) => {
  await open(page);
  await enterDraw(page);
  await keyboardPath(page);
  const authored = await snapshot(page);
  const captured = await page.evaluate(async () => {
    const { captureHeaderPresetState } = await import('./src/site/header-presets.js');
    return captureHeaderPresetState();
  });
  expect(captured.instrumentId).toBe('domino-run');
  const {loop,autoStand,standDelay,...musicalParams}=authored.params;
  expect(captured.snapshot).toEqual({...authored,params:musicalParams});
  expect(captured.selectedId).toBeNull();
  expect(JSON.parse(JSON.stringify(captured.snapshot)).drawing).toEqual(authored.drawing);

  await page.locator('.header-preset-picker summary').click();
  await page.locator('#header-preset-panel button[data-preset-id="glass-coil"]').click();
  expect((await snapshot(page)).drawing).toBeNull();
  await expect(page.locator('#sceneName')).toHaveText('Glass Coil');
  await keyboardPath(page);
  expect((await snapshot(page)).drawing.strokes).toHaveLength(1);
  await page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click();
  expect((await snapshot(page)).drawing).toBeNull();
  await keyboardPath(page);
  expect((await snapshot(page)).drawing.strokes).toHaveLength(1);
  await page.locator('#newRun').click();
  expect((await snapshot(page)).drawing).toBeNull();
  expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
});

test('sound controls preserve authored points, while New pattern and Undo recover the scene', async ({ page }) => {
  await open(page);
  await enterDraw(page);
  await keyboardPath(page);
  const authored = await snapshot(page), geometry = (await runState(page)).dominoes;
  await page.locator('#brightness').focus();
  await page.keyboard.press('End');
  expect((await snapshot(page)).params.brightness).toBe(1);
  expect((await snapshot(page)).drawing).toEqual(authored.drawing);
  expect((await runState(page)).dominoes).toEqual(geometry);
  await page.locator('#material').selectOption('metal');
  await expect.poll(async () => (await runState(page)).dominoes.every(tile => tile.material === 'metal')).toBe(true);
  expect((await snapshot(page)).drawing).toEqual(authored.drawing);
  const updated = await snapshot(page);
  await page.locator('#newPattern').click();
  expect((await snapshot(page)).drawing.strokes).toEqual([]);
  expect((await runState(page)).dominoes).toEqual([]);
  await expect(page.locator('#runStatus')).toHaveText('Draw a path to begin');
  await page.locator('#undoDraw').click();
  expect(await snapshot(page)).toEqual(updated);
  // Henge was the underlying generated layout before this drawing; selecting
  // that same value must still leave the custom pattern.
  await page.locator('#layout').selectOption('henge');
  await expect.poll(async () => (await snapshot(page)).drawing).toBeNull();
  await expect.poll(async () => (await runState(page)).params.layout).toBe('henge');
});

test.describe('touch drawing', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch commit creates one stroke and touch cancellation leaves the scene unchanged', async ({ page }) => {
    await open(page);
    const factory = await snapshot(page);
    await page.getByRole('button', { name: 'Draw', exact: true }).tap();
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const cdp = await page.context().newCDPSession(page);
    try {
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      const pointsFor = async y => {
        const box = await page.locator('#stage').boundingBox();
        return Array.from({ length: 13 }, (_, i) => ({
          x: box.x + box.width * (.18 + .64 * i / 12),
          y: box.y + box.height * (y + .07 * Math.sin(i / 12 * Math.PI)),
        }));
      };
      const first = await pointsFor(.46);
      await touch('touchStart', [first[0]]);
      for (const point of first.slice(1)) await touch('touchMove', [point]);
      await touch('touchEnd', []);
      const committed = await snapshot(page);
      expect(committed.drawing.strokes).toHaveLength(1);
      expect(committed.drawing.strokes[0].points.length).toBeGreaterThan(5);
      const second = await pointsFor(.62);
      await touch('touchStart', [second[0]]);
      for (const point of second.slice(1)) await touch('touchMove', [point]);
      await touch('touchCancel', []);
      expect(await snapshot(page)).toEqual(committed);
      await expect(page.locator('#finishPath')).toBeDisabled();
      // Raw CDP drags can suppress Chromium's following synthetic tap click.
      // Verify recovery with native keyboard activation separately from touch.
      await page.locator('#undoDraw').press('Enter');
      expect(await snapshot(page)).toEqual(factory);
      expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally {
      await cdp.detach();
    }
  });
});
