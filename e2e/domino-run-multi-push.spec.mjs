import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const state = page => page.evaluate(() => ({ time: window.dominoRun.time, playing: window.dominoRun.playing,
  timeline: window.dominoRun.timeline, run: window.dominoRun.run, audio: window.dominoRun.audio }));
const signature = fall => ({ id: fall.id, start: fall.start, duration: fall.duration, kick: fall.kick, times: fall.times });
function started(state) { return state.timeline.falls.filter(fall => fall.start <= state.time + 1e-6).map(signature); }
function preserved(before, after) {
  for (const expected of before) {
    const actual = after.timeline.falls.find(fall => fall.id === expected.id && Math.abs(fall.start - expected.start) < 1e-9);
    expect(actual, `started fall ${expected.id}@${expected.start} remains`).toBeTruthy();
    expect(signature(actual)).toEqual(expected);
  }
}
async function open(page, { fast = false, renew = false, loop = false } = {}) {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  await page.locator('#autoStand').uncheck();
  await page.locator('#loop').setChecked(loop);
  await endpoint(page, 'speed', fast ? 'End' : 'Home');
  await endpoint(page, 'sizeVariation', 'Home');
  if (renew) { await page.locator('#autoStand').check(); await endpoint(page, 'standDelay', 'Home'); }
}
async function endpoint(page, id, key) {
  const input = page.locator(`#${id}`);
  await input.scrollIntoViewIfNeeded(); await input.press(key);
  const value = Number(await input.inputValue());
  await expect.poll(() => page.evaluate(key => window.dominoRun.snapshot.params[key], id)).toBe(value);
  if (!['speed', 'ring', 'brightness', 'soundVariation'].includes(id)) {
    await expect.poll(() => page.evaluate(key => window.dominoRun.run.params[key], id)).toBe(value);
  }
}
async function mouseAt(page, point) {
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + point.x, box.y + point.y);
}
async function exposedPoints(page, ids) {
  // Select through the actual painted hit surface before beginning transport.
  // Centers can be occluded, so try nearby face points in harmless Orbit mode.
  await page.locator('[data-mode="view"]').click();
  const points = [];
  for (const id of ids) {
    const target = await page.evaluate(id => window.dominoRun.targets.find(t => t.id === id), id);
    expect(target, `domino ${id} has a projected target`).toBeTruthy();
    let found = null;
    for (const [dx, dy] of [[0,0],[-8,0],[8,0],[0,-15],[-14,-15],[14,-15],[-18,8],[18,8],[0,18]]) {
      const point = { x: target.x + dx, y: target.y + dy };
      if (await page.evaluate(() => window.dominoRun.selected) === id) await page.locator('#stage').press('ArrowRight');
      await mouseAt(page, point);
      if (await page.evaluate(() => window.dominoRun.selected) === id) { found = point; break; }
    }
    expect(found, `domino ${id} exposes a playable painted face`).toBeTruthy();
    points.push(found);
  }
  await page.locator('[data-mode="push"]').click();
  return points;
}
async function visibleFaces(page) {
  await page.locator('[data-mode="view"]').click();
  const targets = await page.evaluate(() => window.dominoRun.targets), faces = new Map();
  for (const target of targets) {
    await page.locator('#stage').press('ArrowRight');
    const before = await page.evaluate(() => window.dominoRun.selected);
    await mouseAt(page, target);
    const id = await page.evaluate(() => window.dominoRun.selected);
    if (id !== before) faces.set(id, { x: target.x, y: target.y });
  }
  await page.locator('[data-mode="push"]').click();
  return faces;
}
async function stroke(page, y) {
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width * .20, box.y + box.height * y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(box.x + box.width * (.20 + .58 * step / 20), box.y + box.height * (y + .018 * Math.sin(step / 20 * Math.PI)));
  }
  await page.mouse.up();
}
async function separateChains(page, options = {}) {
  await open(page, options);
  await page.locator('[data-mode="draw"]').click();
  const heights = options.heights || [.35, .68];
  for (const y of heights) await stroke(page, y);
  const run = await page.evaluate(() => window.dominoRun.run);
  expect(run.roots).toHaveLength(heights.length);
  const points = await exposedPoints(page, run.roots);
  return { ids: run.roots, points };
}
async function beginTwo(page, { ids, points }, minimumTime = .08) {
  await mouseAt(page, points[0]);
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(minimumTime);
  const before = await state(page);
  expect(started(before).some(fall => fall.id === ids[0])).toBe(true);
  await mouseAt(page, points[1]);
  expect(await page.evaluate(() => window.dominoRun.selected)).toBe(ids[1]);
  await expect.poll(() => page.evaluate(id => window.dominoRun.timeline.falls.some(fall => fall.id === id && fall.start <= window.dominoRun.time + .01), ids[1])).toBe(true);
  const after = await state(page);
  preserved(started(before), after);
  expect(after.time).toBeGreaterThanOrEqual(before.time - .001);
  expect(after.timeline.falls.some(fall => fall.id === ids[1] && fall.start <= after.time + .01)).toBe(true);
  return after;
}
async function selectOnStage(page, id) {
  const [point] = await exposedPoints(page, [id]);
  expect(await page.evaluate(() => window.dominoRun.selected)).toBe(id);
  return point;
}

test('successive real mouse pushes keep two independent fronts and the original fall clock', async ({ page }) => {
  const route = await separateChains(page);
  const after = await beginTwo(page, route);
  for (const id of route.ids) {
    expect(after.timeline.falls.some(fall => fall.id === id && fall.start <= after.time && fall.start + fall.duration > after.time), `root ${id} is falling simultaneously`).toBe(true);
  }
  expect(after.audio.state).toBe('uninitialized'); expect(after.audio.armed).toBe(false);
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(after.time + .08);
  preserved(started(after), await state(page));
});

test('converging waves topple shared pieces once and a fallen piece cannot restart the run', async ({ page }) => {
  await open(page, { fast: true }); await endpoint(page, 'count', 'Home');
  const faces = await visibleFaces(page);
  const ids = [...faces.keys()];
  let pair = null, gap = -1;
  for (const a of ids) for (const b of ids) {
    const distance = Math.min(Math.abs(a - b), 16 - Math.abs(a - b));
    if (distance > gap) { gap = distance; pair = [a, b]; }
  }
  expect(gap, 'separated visible pieces around the ring').toBeGreaterThanOrEqual(5);
  await beginTwo(page, { ids: pair, points: pair.map(id => faces.get(id)) }, .02);
  await expect.poll(() => page.evaluate(() => window.dominoRun.playing), { timeout: 10000 }).toBe(false);
  const ended = await state(page);
  expect(new Set(ended.timeline.falls.map(fall => fall.id)).size).toBe(16);
  for (const id of ended.run.dominoes.map(tile => tile.id)) expect(ended.timeline.falls.filter(fall => fall.id === id)).toHaveLength(1);
  const fallenFaces = await visibleFaces(page);
  expect(fallenFaces.size).toBeGreaterThan(0);
  const [fallenId, fallenPoint] = [...fallenFaces.entries()][0];
  await mouseAt(page, fallenPoint);
  expect(await page.evaluate(() => window.dominoRun.selected)).toBe(fallenId);
  const unchanged = await state(page);
  expect(unchanged.playing).toBe(false); expect(unchanged.time).toBeCloseTo(ended.time, 3);
  expect(unchanged.timeline.falls.map(signature)).toEqual(ended.timeline.falls.map(signature));
});

test('Enter, Push selected, and MIDI notes add strikes to the running scene', async ({ page }) => {
  const { ids, points } = await separateChains(page, { heights: [.22, .41, .6, .79] });
  await mouseAt(page, points[0]);
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(.08);
  let before = await state(page);
  await selectOnStage(page, ids[1]); await page.locator('#stage').press('Enter');
  let after = await state(page); preserved(started(before), after); expect(after.time).toBeGreaterThanOrEqual(before.time);
  expect(after.timeline.falls.some(fall => fall.id === ids[1] && fall.start <= after.time + .01)).toBe(true);
  before = after;
  await selectOnStage(page, ids[2]);
  await page.locator('.group summary').filter({ hasText: 'Edit one domino' }).click();
  await page.locator('#pushSelected').click();
  after = await state(page); preserved(started(before), after); expect(after.time).toBeGreaterThanOrEqual(before.time);
  expect(after.timeline.falls.some(fall => fall.id === ids[2] && fall.start <= after.time + .01)).toBe(true);
  before = after;
  const handled = await page.evaluate(note => {
    const event = new CustomEvent('morphazoid:midi-input', { cancelable: true, detail: { message: { type: 'noteOn', note, velocity: 100 }, source: 'test' } });
    window.dispatchEvent(event); return event.defaultPrevented;
  }, ids[3]);
  expect(handled).toBe(true);
  after = await state(page); preserved(started(before), after); expect(after.time).toBeGreaterThanOrEqual(before.time);
  expect(after.timeline.falls.some(fall => fall.id === ids[3] && fall.start <= after.time + .01)).toBe(true);
  expect(after.audio.armed).toBe(false);
});

test('pause, resume, and sound-only edits preserve both manual pushes', async ({ page }) => {
  const route = await separateChains(page); const pushed = await beginTwo(page, route);
  await page.locator('#playButton').click();
  const paused = await state(page); expect(paused.playing).toBe(false);
  await page.waitForTimeout(160);
  expect((await state(page)).time).toBeCloseTo(paused.time, 3);
  await endpoint(page, 'soundVariation', 'End'); await endpoint(page, 'brightness', 'Home');
  const edited = await state(page); preserved(started(pushed), edited);
  expect(edited.playing).toBe(false); expect(edited.time).toBeCloseTo(paused.time, 3);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(paused.time + .08);
  const resumed = await state(page); preserved(started(pushed), resumed);
  for (const id of route.ids) expect(resumed.timeline.falls.some(fall => fall.id === id)).toBe(true);
  expect(resumed.audio.armed).toBe(false);
});

test('Stand again lets a recovered domino accept a later additive push', async ({ page }, testInfo) => {
  const route = await separateChains(page, { fast: true, renew: true });
  const pushed = await beginTwo(page, route, .02);
  const first = pushed.timeline.falls.find(fall => fall.id === route.ids[0]);
  expect(Number.isFinite(first.standEnd)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.dominoRun.time), { timeout: 10000 }).toBeGreaterThanOrEqual(first.standEnd);
  const before = await state(page);
  const [point] = await exposedPoints(page, [route.ids[0]]);
  await mouseAt(page, point);
  await expect.poll(() => page.evaluate(({ id, standEnd }) => window.dominoRun.timeline.falls.some(fall => fall.id === id && fall.start >= standEnd - .001 && fall.start <= window.dominoRun.time + .01), { id: route.ids[0], standEnd: first.standEnd }), { timeout: 1500 }).toBe(true);
  const after = await state(page);
  await testInfo.attach('recovery-push-state.json', { body: JSON.stringify({ids:route.ids,first,before,after,selected:await page.evaluate(()=>window.dominoRun.selected)}), contentType:'application/json' });
  expect(await page.evaluate(()=>window.dominoRun.selected)).toBe(route.ids[0]);
  expect(after.time).toBeGreaterThanOrEqual(before.time - .001);
  expect(after.timeline.falls.some(fall => fall.id === route.ids[0] && fall.start >= first.standEnd - .001 && fall.start <= after.time + .01)).toBe(true);
  const other = before.timeline.falls.filter(fall => fall.id === route.ids[1]).map(signature);
  preserved(other, after); expect(after.audio.armed).toBe(false);
});

test('finite whole-run looping repeats the manually launched fronts after its normal reset', async ({ page }) => {
  const route = await separateChains(page, { fast: true, loop: true });
  const pushed = await beginTwo(page, route, .02);
  const roots = route.ids.map(id => pushed.timeline.falls.find(fall => fall.id === id)).map(signature);
  await page.waitForFunction(async () => {
    const deadline = performance.now() + 12000;
    let previous = window.dominoRun.time;
    while (performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 35));
      const next = window.dominoRun.time;
      if (next < previous - .15) return true;
      previous = next;
    }
    return false;
  }, null, { timeout: 14000 });
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(Math.max(...roots.map(fall => fall.start)) + .03);
  const repeated = await state(page);
  expect(repeated.playing).toBe(true); expect(repeated.run.params.autoStand).toBe(false);
  for (const expected of roots) {
    const actual = repeated.timeline.falls.find(fall => fall.id === expected.id);
    expect(actual).toBeTruthy(); expect(actual.start).toBeCloseTo(expected.start, 3);
  }
  await page.locator('#playButton').click();
  const paused = await state(page); expect(paused.playing).toBe(false);
  await page.waitForTimeout(160);
  expect((await state(page)).time).toBeCloseTo(paused.time, 3);
  await page.locator('#playButton').click();
  const resumed = await state(page);
  expect(resumed.playing).toBe(true);
  expect(resumed.time).toBeGreaterThanOrEqual(paused.time - .001);
  expect(resumed.time).toBeLessThan(paused.time + .5);
  for (const expected of roots) {
    const actual = resumed.timeline.falls.find(fall => fall.id === expected.id);
    expect(actual).toBeTruthy(); expect(signature(actual)).toEqual(expected);
  }
});

test.describe('cancellation and explicit Audio', () => {
  test.use({ hasTouch: true });
  test('a cancelled pointer never pushes; real pushes remain silent until Audio is armed', async ({ page }, testInfo) => {
    const { ids, points } = await separateChains(page);
    const before = await state(page);
    await page.locator('#stage').scrollIntoViewIfNeeded(); const box = await page.locator('#stage').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + points[0].x, y: box.y + points[0].y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    } finally { await cdp.detach(); }
    const cancelled = await state(page);
    expect(cancelled.playing).toBe(false); expect(cancelled.time).toBe(before.time);
    expect(cancelled.timeline.falls).toEqual(before.timeline.falls);
    const pushed = await beginTwo(page, { ids, points });
    expect(pushed.audio.state).toBe('uninitialized');
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.dominoRun.audio.played)).toBeGreaterThan(0);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 900, intervalMs: 40 });
    await testInfo.attach('additive-push-audio.json', { body: JSON.stringify(envelope.summary), contentType: 'application/json' });
    expect(envelope.summary.finite).toBe(true); expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
    expect(envelope.summary.clippedSamples).toBe(0);
    const sounded = await state(page); preserved(started(pushed), sounded);
    expect(sounded.audio.active).toBeLessThanOrEqual(96); expect(sounded.audio.queued).toBeLessThanOrEqual(4096);
    expect(sounded.audio.dropped).toBe(0); expect(sounded.playing).toBe(true);
  });
});
