import { expect, test } from '@playwright/test';

const liveKeys = ['loop', 'autoStand', 'standDelay'];
const live = page => page.evaluate(() => ({
  loop: document.querySelector('#loop').checked,
  autoStand: document.querySelector('#autoStand').checked,
  standDelay: Number(document.querySelector('#standDelay').value),
}));
const capture = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import('./src/site/header-presets.js');
  return captureHeaderPresetState();
});
const open = async page => {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
};
const range = async (page, id, value) => {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};
const preset = async (page, id) => {
  await page.locator('.header-preset-picker summary').click();
  await page.locator(`#header-preset-panel button[data-preset-id="${id}"]`).click();
};
const shortRun = async page => {
  await page.locator('#layout').selectOption('serpentine');
  for (const [id, value] of Object.entries({ count: 16, size: .65, sizeVariation: 0, growth: 0, spacing: .54, speed: 2.4 })) {
    await range(page, id, value);
  }
  await expect.poll(() => page.evaluate(() => {
    const p = window.dominoRun.run.params;
    return [p.layout, p.count, p.size, p.sizeVariation, p.growth, p.spacing, window.dominoRun.snapshot.params.speed];
  })).toEqual(['serpentine', 16, .65, 0, 0, .54, 2.4]);
  // Let the final structural input's 55ms debounce finish before the next action.
  await page.waitForTimeout(90);
};
const checkCanonical = async page => {
  const state = await capture(page);
  for (const key of liveKeys) expect(state.snapshot.params).not.toHaveProperty(key);
  const actual = await page.evaluate(() => window.dominoRun.snapshot);
  for (const key of liveKeys) delete actual.params[key];
  expect(state.snapshot).toEqual(actual);
  return state;
};
async function observeWraps(page, count = 2) {
  return page.evaluate(async count => {
    const cycle = (window.dominoRun.timeline.duration + .85) / window.dominoRun.snapshot.params.speed;
    const deadline = performance.now() + (count + 1) * cycle * 1000 + 1200;
    const wraps = [];
    let previous = window.dominoRun.time;
    while (wraps.length < count && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const now = window.dominoRun.time;
      if (!window.dominoRun.playing) throw new Error('The loop stopped before its next wrap');
      if (now < previous - .05) wraps.push({ time: now, played: window.dominoRun.audio.played });
      previous = now;
    }
    if (wraps.length !== count) throw new Error(`Observed ${wraps.length}/${count} loop wraps`);
    return wraps;
  }, count);
}

test('live repeat and recovery controls survive real scene recalls without changing canonical preset labels', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await open(page);
  await preset(page, 'classic-plastic');
  const before = await capture(page);
  await page.locator('#loop').uncheck();
  await page.locator('#autoStand').check();
  await range(page, 'standDelay', .7);
  await range(page, 'level', .23);
  await page.waitForTimeout(100);
  const selected = await checkCanonical(page);
  expect(selected.snapshot).toEqual(before.snapshot);
  expect(selected.selectedId).toBe('classic-plastic');
  await expect(page.locator('.header-preset-picker .instrument-picker-current')).toHaveText('Classic Plastic');
  await expect(page.locator('#sceneName')).toHaveText('Classic Plastic');

  const desired = { loop: false, autoStand: true, standDelay: .7 };
  const actions = [
    () => preset(page, 'tone-henge'),
    () => page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click(),
    () => page.locator('#newRun').click(),
  ];
  for (const [index, action] of actions.entries()) {
    const previous = await capture(page);
    await action();
    const current = await checkCanonical(page);
    expect(current.snapshot).not.toEqual(previous.snapshot);
    expect(await live(page)).toEqual(desired);
    expect(await page.evaluate(() => window.dominoRun.playing)).toBe(false);
    expect(await page.evaluate(() => window.dominoRun.audio.state)).toBe('uninitialized');
    expect(await page.locator('#level').inputValue()).toBe('0.23');
    expect(current.selectedId).toBe(index === 0 ? 'tone-henge' : null);
    await expect(page.locator('.header-preset-picker .instrument-picker-current')).toHaveText(index === 0 ? 'Tone Henge' : 'Preset · Custom');
  }
  expect(errors).toEqual([]);
});

test('preset, dice and New random run keep audible whole-run loops crossing later cycle boundaries', async ({ page }) => {
  await open(page);
  await shortRun(page);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  const desired = await live(page);
  const actions = [
    () => preset(page, 'loose-porcelain'),
    () => page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click(),
    () => page.locator('#newRun').click(),
  ];
  for (const action of actions) {
    await action();
    expect(await live(page)).toEqual(desired);
    expect(await page.evaluate(() => window.dominoRun.playing)).toBe(true);
    expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(true);
    await shortRun(page);
    const wraps = await observeWraps(page);
    expect(wraps[1].played).toBeGreaterThan(wraps[0].played);
    expect(await page.evaluate(() => window.dominoRun.audio.dropped)).toBe(0);
  }
  await page.locator('#audioButton').click();
  await preset(page, 'tone-henge');
  const muted = await page.evaluate(() => window.dominoRun.time);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(muted + .1);
  expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
  await page.locator('#playButton').click();
  await page.locator('#newRun').click();
  const paused = await page.evaluate(() => window.dominoRun.time);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.dominoRun.time)).toBeCloseTo(paused, 5);
  expect(await page.evaluate(() => window.dominoRun.playing)).toBe(false);
  expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
});

test('recall during the silent reset gap starts the new scene at phase zero', async ({ page }) => {
  await open(page);
  await shortRun(page);
  await page.locator('#playButton').click();
  await page.locator('.header-preset-picker summary').click();
  const evidence = await page.evaluate(async () => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const time = window.dominoRun.time, duration = window.dominoRun.timeline.duration;
      if (time > duration + .5 && time < duration + .72) {
        document.querySelector('#header-preset-panel button[data-preset-id="classic-plastic"]').click();
        return { before: { time, duration }, after: { time: window.dominoRun.time,
          duration: window.dominoRun.timeline.duration, playing: window.dominoRun.playing } };
      }
      await new Promise(requestAnimationFrame);
    }
    throw new Error('Did not enter the bounded reset-gap window');
  });
  expect(evidence.before.time).toBeGreaterThan(evidence.before.duration);
  expect(evidence.after.time).toBeLessThan(.15);
  expect(evidence.after.playing).toBe(true);
  expect(await page.evaluate(() => window.dominoRun.audio.state)).toBe('uninitialized');
  await expect(page.locator('.header-preset-picker .instrument-picker-current')).toHaveText('Classic Plastic');
});

test('a scene recall cancels an earlier structural edit instead of rebasing again after its debounce', async ({ page }) => {
  await open(page);
  await shortRun(page);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(.4);
  await page.locator('.header-preset-picker summary').click();
  const evidence = await page.evaluate(async () => {
    const input = document.querySelector('#spacing');
    input.value = '.53'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#header-preset-panel button[data-preset-id="classic-plastic"]').click();
    const start = performance.now(), initial = window.dominoRun.time;
    const speed = window.dominoRun.snapshot.params.speed;
    const errors = [];
    while (performance.now() - start < 230) {
      await new Promise(resolve => setTimeout(resolve, 8));
      const elapsed = (performance.now() - start) / 1000;
      errors.push(window.dominoRun.time - initial - elapsed * speed);
    }
    return { errors, playing: window.dominoRun.playing };
  });
  expect(Math.max(...evidence.errors.map(Math.abs))).toBeLessThan(.025);
  expect(evidence.playing).toBe(true);
  await expect(page.locator('.header-preset-picker .instrument-picker-current')).toHaveText('Classic Plastic');
});

test('audio catches up into the current cycle after more than two queued cycles pass during a UI stall', async ({ page }) => {
  await open(page);
  await shortRun(page);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.dominoRun.audio.played)).toBeGreaterThan(0);
  const stalled = await page.evaluate(() => {
    const duration = window.dominoRun.timeline.duration;
    const speed = window.dominoRun.snapshot.params.speed;
    const target = 2 * (duration + .85) + duration * .2;
    const milliseconds = (target - window.dominoRun.time) / speed * 1000;
    if (milliseconds < 1500 || milliseconds > 6000) throw new Error(`Unexpected bounded stall: ${milliseconds}ms`);
    const deadline = performance.now() + milliseconds;
    while (performance.now() < deadline) { /* Audio continues while app ticks cannot run. */ }
    return { time: window.dominoRun.time, duration };
  });
  expect(stalled.time).toBeGreaterThan(stalled.duration * .1);
  expect(stalled.time).toBeLessThan(stalled.duration * .45);
  // Drain messages accumulated during the stall before counting new attacks.
  await page.waitForTimeout(120);
  const before = await page.evaluate(() => window.dominoRun.audio.played);
  await page.waitForTimeout(260);
  expect(await page.evaluate(() => window.dominoRun.audio.played)).toBeGreaterThan(before);
  expect(await page.evaluate(() => window.dominoRun.time)).toBeLessThan(stalled.duration);
  expect(await page.evaluate(() => window.dominoRun.playing)).toBe(true);
  expect(await page.evaluate(() => window.dominoRun.audio.dropped)).toBe(0);
});

test('Undo preserves live repeat controls and cancels a pending Stand again rebuild', async ({ page }) => {
  await open(page);
  await preset(page, 'tone-henge');
  const original = await capture(page);
  const height = await page.evaluate(() => window.dominoRun.run.dominoes[0].height);
  await page.locator('#selectedDomino summary').click();
  await page.locator('#tileSize').evaluate(input => {
    input.value = '2'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.dominoRun.snapshot.edits.length)).toBe(1);

  // These choices differ from the values saved before the tile edit.
  await page.locator('#loop').uncheck();
  await page.locator('#autoStand').check();
  await range(page, 'standDelay', .7);
  await page.waitForTimeout(100);
  await page.locator('#autoStand').uncheck();
  await page.waitForTimeout(100);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.dominoRun.time)).toBeGreaterThan(.3);

  const evidence = await page.evaluate(async () => {
    // Two actual control clicks in one browser turn put Undo inside the 55ms
    // debounce window without adding a product setter or altering its timers.
    document.querySelector('#autoStand').click();
    document.querySelector('#undoEdit').click();
    const start = performance.now(), initial = window.dominoRun.time;
    const errors = [];
    while (performance.now() - start < 230) {
      await new Promise(resolve => setTimeout(resolve, 8));
      errors.push(window.dominoRun.time - initial - (performance.now() - start) / 1000);
    }
    const p = window.dominoRun.snapshot.params;
    return { errors, live: { loop: p.loop, autoStand: p.autoStand, standDelay: p.standDelay },
      edits: window.dominoRun.snapshot.edits, height: window.dominoRun.run.dominoes[0].height,
      hasRecovery: window.dominoRun.timeline.falls.some(fall => Number.isFinite(fall.standEnd)),
      playing: window.dominoRun.playing, audioState: window.dominoRun.audio.state };
  });
  const desired = { loop: false, autoStand: true, standDelay: .7 };
  expect(evidence.live).toEqual(desired);
  expect(await live(page)).toEqual(desired);
  expect(evidence.edits).toEqual([]);
  expect(evidence.height).toBeCloseTo(height, 8);
  expect(evidence.hasRecovery).toBe(true);
  expect(Math.max(...evidence.errors.map(Math.abs))).toBeLessThan(.025);
  expect(evidence.playing).toBe(true);
  expect(evidence.audioState).toBe('uninitialized');
  const restored = await checkCanonical(page);
  expect(restored.snapshot).toEqual(original.snapshot);
  expect(restored.selectedId).toBe('tone-henge');
  await expect(page.locator('.header-preset-picker .instrument-picker-current')).toHaveText('Tone Henge');
});
