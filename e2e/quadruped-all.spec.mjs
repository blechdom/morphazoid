import { test, expect } from '@playwright/test';

const all = page => page.locator('#allActorsButton');
const actorButton = (page, index) => page.locator(`button[data-actor-index="${index}"]`);
const handle = (page, index) => page.locator(`.quadruped-animal-handle[data-gesture-actor="${index}"]`);
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
const probe = page => page.evaluate(() => globalThis.__quadrupedAllProbe.read());
const mixed = (page, selector) => page.locator(selector).evaluate(node => node.dataset.mixed === 'true' || node.closest('.quadruped-control')?.dataset.mixed === 'true');

async function openInstrument(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      let allProbeResets = 0;
      const originalAllReset = resetAudioSchedule;
      resetAudioSchedule = (...args) => { allProbeResets++; return originalAllReset(...args); };
      const allJumpSamples = [];
      const originalAllPose = performedPose;
      performedPose = (...args) => {
        const next = originalAllPose(...args);
        if (performanceFor(args[0]).motion?.kind === 'jump') allJumpSamples.push({
          actorIndex: args[0], addedLift: (next.bodyLift - args[1].bodyLift) * .38 });
        return next;
      };
      globalThis.__quadrupedAllProbe = { read: () => ({
        jumps: allJumpSamples.slice(),
        resets: allProbeResets, audioTime: graph?.context.currentTime ?? null,
        actors: displayMotorSnapshots().map(snapshot => ({ position: snapshot.position, elapsed: snapshot.elapsedSeconds })),
      }) };
    ` });
  });
  await page.goto('/quadruped.html');
  await expect(actorButton(page, 0)).toBeVisible();
  return errors;
}

async function distinctTrio(page) {
  await page.locator('[data-group-mode="trio"]').click();
  for (let index = 0; index < 3; index++) {
    await actorButton(page, index).click();
    for (const [id, values] of Object.entries({ momentum: [.4, .9, 1.4], gravity: [.8, 1.1, 1.8], pitchSemitones: [-12, 0, 12], lopsided: [-.3, 0, .3], spring: [.4, 1.2, 2] })) {
      await page.locator('#' + id).fill(String(values[index]));
    }
    if (index === 1) {
      await page.locator('#behaviorSelect').selectOption('walk-leap');
      await page.locator('#suspensionBeats').fill('4');
    }
  }
  await actorButton(page, 0).click();
}

test('All arms editing without changing scores and the reference number returns to individual editing', async ({ page }) => {
  const errors = await openInstrument(page);
  await expect(all(page)).toBeHidden();
  await page.locator('[data-group-mode="trio"]').click();
  const before = await capture(page), observed = await probe(page);
  await all(page).click();
  await expect(all(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sequenceTitle')).toHaveText('All · score 1');
  expect(await capture(page)).toEqual(before);
  expect((await probe(page)).resets).toBe(observed.resets);
  expect(await mixed(page, '#animalSelect')).toBe(true);
  expect(await mixed(page, '#behaviorSelect')).toBe(true);
  await actorButton(page, 0).click();
  await expect(all(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(actorButton(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pitchSemitones').fill('7');
  const after = await capture(page);
  expect(after.actors[0].pitchSemitones).toBe(7);
  expect(after.actors.slice(1)).toEqual(before.actors.slice(1));
  expect(errors).toEqual([]);
});

test('All changes only each edited setting while the live trio keeps its clocks and distinct scores', async ({ page }) => {
  const errors = await openInstrument(page);
  await distinctTrio(page);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await all(page).click();
  expect(await mixed(page, '#pitchSemitones')).toBe(true);
  expect(await mixed(page, '#spring')).toBe(true);
  // The reference walks; another actor has a leap, so All must expose Rest.
  await expect(page.locator('#suspensionControl')).toBeVisible();
  for (const [id, value] of Object.entries({ momentum: 1.17, gravity: .63, pitchSemitones: -7.5, lopsided: -.42, spring: 1.73, suspensionBeats: 3 })) {
    const before = await capture(page), clock = await probe(page);
    await page.locator('#' + id).fill(String(value));
    const after = await capture(page), nextClock = await probe(page);
    expect(after).toEqual({ ...before, actors: before.actors.map(score => ({ ...score, [id]: value })) });
    expect(nextClock.resets - clock.resets, `${id} invalidates the schedule once`).toBe(1);
    expect(await mixed(page, '#' + id)).toBe(false);
    for (let index = 0; index < 3; index++) {
      expect(nextClock.actors[index].position).toBeGreaterThanOrEqual(clock.actors[index].position);
      expect(Math.abs(nextClock.actors[index].elapsed - clock.actors[index].elapsed - (nextClock.audioTime - clock.audioTime))).toBeLessThan(.025);
    }
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#playButton').click();
  expect(errors).toEqual([]);
});

test('choosing the reference Animal or Gait in All still updates different companions', async ({ page }) => {
  const errors = await openInstrument(page);
  await distinctTrio(page);
  await all(page).click();
  let before = await capture(page);
  const animal = before.actors[before.selectedActor].animalId;
  await page.locator('#animalSelect').selectOption(animal);
  let after = await capture(page);
  expect(after.actors.every(score => score.animalId === animal)).toBe(true);
  for (let index = 0; index < 3; index++) {
    expect(after.actors[index].behaviorId).toBe(before.actors[index].behaviorId);
    expect(after.actors[index].pattern).toEqual(before.actors[index].pattern);
    expect(after.actors[index].callPattern).toEqual(before.actors[index].callPattern);
    for (const key of ['pitchSemitones', 'spring', 'lopsided']) expect(after.actors[index][key]).toBe(before.actors[index][key]);
  }
  expect(await mixed(page, '#animalSelect')).toBe(false);
  before = after;
  const gait = before.actors[before.selectedActor].behaviorId;
  await page.locator('#behaviorSelect').selectOption(gait);
  after = await capture(page);
  expect(after.actors.every(score => score.behaviorId === gait)).toBe(true);
  for (let index = 0; index < 3; index++) {
    expect(after.actors[index].animalId).toBe(before.actors[index].animalId);
    expect(after.actors[index].callPattern).toEqual(before.actors[index].callPattern);
    for (const key of ['pitchSemitones', 'spring', 'lopsided']) expect(after.actors[index][key]).toBe(before.actors[index][key]);
  }
  expect(await mixed(page, '#behaviorSelect')).toBe(false);
  expect(errors).toEqual([]);
});

test('All edits one shared grid cell and clears calls without overwriting the other rhythm cells', async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('[data-group-mode="trio"]').click();
  await all(page).click();
  const before = await capture(page);
  const lane = 'front-left', step = 0;
  await page.locator(`[data-lane-id="${lane}"][data-step="${step}"]`).click();
  const after = await capture(page), intensity = after.actors[after.selectedActor].pattern[lane][step];
  for (let index = 0; index < 3; index++) {
    const pattern = structuredClone(before.actors[index].pattern);
    pattern[lane][step] = intensity;
    expect(after.actors[index].pattern).toEqual(pattern);
    const { pattern: ignoredBefore, customized: beforeCustom, ...untouchedBefore } = before.actors[index];
    const { pattern: ignoredAfter, customized: afterCustom, ...untouchedAfter } = after.actors[index];
    expect(untouchedAfter).toEqual(untouchedBefore);
  }
  await page.locator('#callPhraseButton').click();
  const called = await capture(page);
  expect(called.actors.every(score => score.callPattern.flat().filter(Boolean).length === 3)).toBe(true);
  await page.locator('#clearCallsButton').click();
  const cleared = await capture(page);
  for (let index = 0; index < 3; index++) {
    expect(cleared.actors[index].callPattern.flat().every(value => value === 0)).toBe(true);
    expect(cleared.actors[index].pattern).toEqual(after.actors[index].pattern);
  }
  expect(errors).toEqual([]);
});

test('All in Herd edits call cells and clears or remixes every score independently', async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('[data-group-mode="herd"]').click();
  await all(page).click();
  const before = await capture(page);
  const cell = page.locator('[data-call-row="1"][data-step="3"]');
  await cell.click();
  const called = await capture(page), value = called.actors[called.selectedActor].callPattern[1][3];
  for (let index = 0; index < 3; index++) {
    const pattern = structuredClone(before.actors[index].callPattern);
    pattern[1][3] = value;
    expect(called.actors[index].callPattern).toEqual(pattern);
    expect(called.actors[index].pattern).toEqual(before.actors[index].pattern);
  }
  await cell.focus();
  await page.keyboard.press('Delete');
  expect((await capture(page)).actors.every(score => score.callPattern[1][3] === 0)).toBe(true);
  await page.locator('[data-call-row="2"][data-step="5"]').click();
  const withCalls = (await capture(page)).actors;
  expect(withCalls.every(score => score.callPattern[2][5] > 0)).toBe(true);
  await page.locator('#clearButton').click();
  let scores = (await capture(page)).actors;
  for (let index = 0; index < 3; index++) expect(scores[index].callPattern).toEqual(withCalls[index].callPattern);
  expect(scores.every(score => Object.values(score.pattern).flat().every(value => value === 0))).toBe(true);
  await page.locator('[data-lane-id="front-left"][data-step="0"]').click();
  scores = (await capture(page)).actors;
  expect(scores.every(score => score.pattern['front-left'][0] > 0)).toBe(true);
  await page.keyboard.press('Delete');
  scores = (await capture(page)).actors;
  expect(scores.every(score => Object.values(score.pattern).flat().every(value => value === 0))).toBe(true);
  await page.locator('[data-lane-id="front-left"][data-step="0"]').click();
  scores = (await capture(page)).actors;
  await page.locator('#remixButton').click();
  const remixed = (await capture(page)).actors;
  expect(remixed.every(score => Object.values(score.pattern).flat().some(value => value > 0))).toBe(true);
  for (let index = 0; index < 3; index++) {
    expect(remixed[index].pattern).not.toEqual(scores[index].pattern);
    expect(remixed[index].callPattern).toEqual(scores[index].callPattern);
    for (const key of ['animalId', 'behaviorId', 'momentum', 'pitchSemitones', 'spring', 'lopsided']) {
      expect(remixed[index][key]).toBe(scores[index][key]);
    }
  }
  expect(errors).toEqual([]);
});

test('All actions schedule once for the trio while a direct body gesture stays local', async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator('#tempo').fill('30');
  await page.locator('#audioButton').click();
  await all(page).click();
  const before = await capture(page), observed = await probe(page);
  await page.locator('[data-motion-action="jump"]').click();
  await expect(page.locator('.quadruped-animal-handle[data-action="jump"]')).toHaveCount(3);
  expect((await probe(page)).resets - observed.resets).toBe(1);
  expect(await capture(page)).toEqual(before);
  await expect(page.locator('.quadruped-animal-handle[data-action="idle"]')).toHaveCount(3);
  const groupJumps = (await probe(page)).jumps;
  for (const index of [0, 1, 2]) expect(groupJumps.some(sample => sample.actorIndex === index && sample.addedLift > .1)).toBe(true);
  const point = await handle(page, 1).evaluate(node => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    return { x: stage.x + Number(node.dataset.bodyX), y: stage.y + Number(node.dataset.bodyY) };
  });
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 65, point.y, { steps: 5 });
  await expect(handle(page, 1)).toHaveAttribute('data-action', 'run');
  for (const index of [0, 2]) await expect(handle(page, index)).toHaveAttribute('data-action', 'idle');
  await page.mouse.up();
  await expect(handle(page, 1)).toHaveAttribute('data-action', 'idle');
  // A companion's keyboard gesture must also refresh the All action indicator.
  await handle(page, 1).focus();
  await page.keyboard.press('j');
  await expect(handle(page, 1)).toHaveAttribute('data-action', 'jump');
  await expect(page.locator('[data-motion-action="jump"]')).toHaveAttribute('data-active', 'true');
  for (const index of [0, 2]) await expect(handle(page, index)).toHaveAttribute('data-action', 'idle');
  await expect(handle(page, 1)).toHaveAttribute('data-action', 'idle');
  await expect(page.locator('[data-motion-action="jump"]')).toHaveAttribute('data-active', 'false');
  expect(await capture(page)).toEqual(before);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('Solo, preset recall and Reset leave All unarmed and never serialize the edit scope', async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('[data-group-mode="trio"]').click();
  await all(page).click();
  await page.locator('[data-group-mode="solo"]').click();
  await expect(all(page)).toBeHidden();
  await expect(all(page)).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-group-mode="trio"]').click();
  await expect(all(page)).toHaveAttribute('aria-pressed', 'false');
  await all(page).click();
  await page.locator('.header-preset-controls summary').click();
  await page.locator('button[data-preset-id="earth-procession"]').click();
  await expect(all(page)).toHaveAttribute('aria-pressed', 'false');
  await all(page).click();
  await page.locator('#resetButton').click();
  await expect(all(page)).toBeHidden();
  await expect(all(page)).toHaveAttribute('aria-pressed', 'false');
  expect(Object.keys(await capture(page)).sort()).toEqual(['actors', 'groupMode', 'groupSeed', 'selectedActor', 'soundSkinId', 'version', 'world']);
  expect(errors).toEqual([]);
});

for (const viewport of [{ label: 'desktop', width: 1440, height: 900 }, { label: 'phone portrait', width: 390, height: 844 }, { label: 'phone landscape', width: 844, height: 390 }]) {
  test.describe(viewport.label, () => {
  test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.width < 900, isMobile: viewport.width < 900 });
  test('keeps All beside the numbered animal controls', async ({ page }) => {
    const errors = await openInstrument(page);
    await page.locator('[data-group-mode="trio"]').click();
    await all(page).scrollIntoViewIfNeeded();
    await expect(all(page)).toBeVisible();
    const last = await actorButton(page, 2).boundingBox(), button = await all(page).boundingBox();
    expect(Math.abs(button.y + button.height / 2 - last.y - last.height / 2)).toBeLessThan(2);
    expect(button.x - last.x - last.width).toBeGreaterThanOrEqual(0);
    expect(button.x - last.x - last.width).toBeLessThanOrEqual(12);
    expect(button.x + button.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 900) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await all(page).click();
    await expect(all(page)).toHaveAttribute('aria-pressed', 'true');
    await test.info().attach('all-animal-controls', { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
  });
}
