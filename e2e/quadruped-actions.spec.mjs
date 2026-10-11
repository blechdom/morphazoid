import { test, expect } from '@playwright/test';

const actionButton = (page, action) => page.locator(`[data-motion-action="${action}"]`);
const animalHandle = (page, actor = 0) => page.locator(`.quadruped-animal-handle[data-gesture-actor="${actor}"]`);
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
const audioStatus = page => page.evaluate(async () => (await import('/src/audio-output-manager.js')).getSharedAudioOutputManager().getStatus());
const probe = page => page.evaluate(() => globalThis.__quadrupedActionProbe.read());

async function installActionProbe(page) {
  // Observe real button/transport paths without exposing a production test API
  // or substituting a different clock, scheduler, renderer or synthesis engine.
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const actionStarts = [], actionContacts = [];
      const originalActionMotion = performMotion;
      performMotion = (...args) => {
        const result = originalActionMotion(...args);
        const index = args[0], motion = performances.get(actors[index])?.motion;
        const score = scoreForActor(index);
        actionStarts.push({ actorIndex: index, kind: args[1], untilPosition: motion?.untilPosition,
          position: actors[index].motor.position, behaviorId: score.behaviorId,
          paceRatio: score.paceRatio, suspensionBeats: score.suspensionBeats });
        return result;
      };
      const originalActionContact = scheduleContactSound;
      scheduleContactSound = (...args) => {
        const [phase, , , when, , position, score, actorIndex] = args;
        const motion = performances.get(actors[actorIndex])?.motion;
        if (motion) actionContacts.push({ phase, when, position, actorIndex,
          kind: motion.kind, untilPosition: motion.untilPosition, behaviorId: score.behaviorId });
        return originalActionContact(...args);
      };
      globalThis.__quadrupedActionProbe = {
        read: () => ({
          starts: actionStarts.slice(), contacts: actionContacts.slice(),
          pageActive, schedulerActive: Boolean(schedulerTimer), sourceCount: activeSources.size,
          actors: actors.map(actor => ({ position: actor.motor.position,
            motion: performances.get(actor)?.motion ? { ...performances.get(actor).motion } : null })),
        }),
        stopFrames: () => cancelAnimationFrame(animationFrame),
        resumeFrames: () => { animationFrame = requestAnimationFrame(animationLoop); },
      };
    ` });
  });
}

async function openInstrument(page, { observed = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (observed) await installActionProbe(page);
  await page.goto('/quadruped.html');
  await expect(actionButton(page, 'jump')).toBeVisible();
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'idle');
  return errors;
}

async function expectLiveState(page, playing = false, audio = false) {
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', String(playing));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', String(audio));
}

async function expectActionFinished(page, actor = 0) {
  await expect(animalHandle(page, actor)).toHaveAttribute('data-action', 'idle');
  for (const action of ['jump', 'roll', 'slide']) {
    await expect(actionButton(page, action)).not.toHaveAttribute('data-active', 'true');
  }
}

test('Jump, Roll and Slide perform one selected animal without changing its saved gait or arming Audio', async ({ page }) => {
  const errors = await openInstrument(page, { observed: true });
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator('button[data-actor-index="1"]').click();
  await page.locator('#tempo').fill('60');
  await page.locator('#behaviorSelect').selectOption('walk-leap');
  await page.locator('[data-pace-ratio="3"]').click();
  await page.locator('#suspensionBeats').fill('8');
  const before = await capture(page);
  const otherPositions = (await probe(page)).actors.map(actor => actor.position);

  for (const [action, behaviorId, key] of [['jump', 'jump', 'Enter'], ['roll', 'forward-roll', 'Space'], ['slide', 'skid', null]]) {
    const button = actionButton(page, action);
    await expect(button).toHaveAttribute('type', 'button');
    await expect(button).not.toHaveAttribute('aria-pressed');
    if (key) {
      await button.focus();
      await page.keyboard.press(key);
    } else await button.click();
    await expect(button).toHaveAttribute('data-active', 'true');
    await expect(animalHandle(page, 1)).toHaveAttribute('data-action', action);
    const active = await probe(page);
    expect(active.starts.at(-1)).toMatchObject({ actorIndex: 1, kind: action, behaviorId, paceRatio: 1, suspensionBeats: 0 });
    expect(active.actors[1].motion.untilPosition).toBeGreaterThan(active.actors[1].position);
    for (const actor of [0, 2]) {
      expect(active.actors[actor].position).toBe(otherPositions[actor]);
      await expect(animalHandle(page, actor)).toHaveAttribute('data-action', 'idle');
    }
    expect(await capture(page)).toEqual(before);
    await expectLiveState(page);
    await expectActionFinished(page, 1);
    expect(await capture(page)).toEqual(before);
  }
  expect((await audioStatus(page)).connectionCount).toBe(0);
  expect((await probe(page)).schedulerActive).toBe(false);
  expect(errors).toEqual([]);
});

test('repeated actions restart and Escape, reset and blur release temporary performances', async ({ page }) => {
  const errors = await openInstrument(page, { observed: true });
  const startup = await capture(page);
  await page.locator('#tempo').fill('30');
  const edited = await capture(page);
  const slide = actionButton(page, 'slide');
  await slide.click();
  const first = (await probe(page)).starts.at(-1);
  // Advance within this two-second gesture before asking for a new whole slide.
  await expect.poll(async () => (await probe(page)).actors[0].position).toBeGreaterThan(first.position + .5);
  await slide.click();
  const repeated = (await probe(page)).starts.at(-1);
  expect(repeated.untilPosition).toBeGreaterThan(first.untilPosition);
  await expect(slide).toBeFocused();
  await page.keyboard.press('Escape');
  await expectActionFinished(page);
  expect(await capture(page)).toEqual(edited);
  expect((await probe(page)).schedulerActive).toBe(false);

  await actionButton(page, 'roll').click();
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'roll');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectActionFinished(page);
  expect(await capture(page)).toEqual(edited);

  await actionButton(page, 'jump').click();
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'jump');
  await page.locator('#resetButton').click();
  await expectActionFinished(page);
  expect(await capture(page)).toEqual(startup);
  expect((await probe(page)).actors.every(actor => actor.motion === null)).toBe(true);
  await expectLiveState(page);
  expect((await audioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test('Slide produces its own bounded scrape envelope and action changes preserve live transport', async ({ page }) => {
  const errors = await openInstrument(page, { observed: true });
  await page.locator('#tempo').fill('60');
  const before = await capture(page);
  await page.locator('#audioButton').click();
  await expectLiveState(page, false, true);
  await actionButton(page, 'slide').click();
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'slide');
  await expect.poll(async () => (await audioStatus(page)).rms).toBeGreaterThan(.0002);
  await expect.poll(async () => (await probe(page)).contacts.filter(contact => contact.phase === 'slide').length).toBeGreaterThan(1);
  const sounding = await audioStatus(page);
  expect(sounding.peak).toBeLessThan(.90);
  expect(sounding.clipped).toBe(false);
  await expectActionFinished(page);
  const contacts = (await probe(page)).contacts.filter(contact => contact.kind === 'slide');
  expect(contacts.some(contact => contact.phase === 'slide')).toBe(true);
  expect(contacts.every(contact => contact.position < contact.untilPosition)).toBe(true);
  expect(contacts.filter(contact => contact.phase === 'slide').every(contact => contact.behaviorId === 'skid')).toBe(true);
  await expectLiveState(page, false, true);
  await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
  expect(await capture(page)).toEqual(before);

  await page.locator('#playButton').click();
  for (const action of ['jump', 'roll', 'slide']) {
    await actionButton(page, action).click();
    await expect(animalHandle(page)).toHaveAttribute('data-action', action);
    await expectLiveState(page, true, true);
    await expect.poll(async () => (await audioStatus(page)).rms).toBeGreaterThan(.0002);
    await expectActionFinished(page);
    expect(await capture(page)).toEqual(before);
  }
  await page.locator('#playButton').click();
  await actionButton(page, 'roll').click();
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'roll');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(async () => (await audioStatus(page)).connectionCount).toBe(0);
  const tornDown = await probe(page);
  expect(tornDown.pageActive).toBe(false);
  expect(tornDown.schedulerActive).toBe(false);
  expect(tornDown.sourceCount).toBe(0);
  expect(tornDown.actors.every(actor => actor.motion === null)).toBe(true);
  expect(errors).toEqual([]);
  await test.info().attach('quadruped-action-contacts', { body: JSON.stringify(contacts), contentType: 'application/json' });
});

for (const viewport of [
  { label: 'desktop', width: 1440, height: 900, mobile: false },
  { label: 'phone portrait', width: 390, height: 844, mobile: true },
  { label: 'phone landscape', width: 844, height: 390, mobile: true },
]) {
  test(`${viewport.label} keeps action buttons beside transport and shows BPM only at Tempo`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL,
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile, hasTouch: viewport.mobile, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const errors = await openInstrument(page);
      const group = page.locator('.quadruped-transport-card .quadruped-action-row');
      await expect(group.locator('[data-motion-action]')).toHaveCount(3);
      await page.locator('#playButton').click();
      await expect(page.locator('#tempoOut')).toHaveText('96 BPM · global');
      await expect(page.locator('#playState')).not.toContainText('BPM');
      await expect(page.locator('#motionSummary')).not.toContainText('BPM');
      for (const action of ['jump', 'roll', 'slide']) {
        const button = actionButton(page, action);
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
        await button.click({ trial: true });
        const box = await button.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(viewport.mobile ? 44 : 32);
        expect(box.height).toBeGreaterThanOrEqual(viewport.mobile ? 44 : 32);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      const overflow = await page.evaluate(() => {
        const group = document.querySelector('.quadruped-action-row');
        const console = document.querySelector('.quadruped-console');
        return { document: document.documentElement.scrollWidth - innerWidth,
          group: group.scrollWidth - group.clientWidth, console: console.scrollWidth - console.clientWidth };
      });
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.group).toBeLessThanOrEqual(1);
      expect(overflow.console).toBeLessThanOrEqual(1);
      if (viewport.mobile) {
        const playBox = await page.locator('#playButton').boundingBox();
        expect(playBox.width).toBeGreaterThanOrEqual(48);
        expect(playBox.height).toBeGreaterThanOrEqual(48);
      }
      await expectLiveState(page, true, false);
      expect(errors).toEqual([]);
      await test.info().attach('action-layout', { body: await page.screenshot(), contentType: 'image/png' });
    } finally {
      await context.close();
    }
  });
}


test('Trio actions overlap without changing other performers and complete at minimum tempo', async ({ page }) => {
  const errors = await openInstrument(page, { observed: true });
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator('#tempo').fill('10');
  const before = await capture(page);
  await actionButton(page, 'slide').click();
  const first = (await probe(page)).actors[0].motion;
  await page.locator('button[data-actor-index="1"]').click();
  await actionButton(page, 'roll').click();
  await expect(animalHandle(page, 0)).toHaveAttribute('data-action', 'slide');
  await expect(animalHandle(page, 1)).toHaveAttribute('data-action', 'roll');
  expect((await probe(page)).actors[0].motion).toEqual(first);
  await expect(animalHandle(page, 2)).toHaveAttribute('data-action', 'idle');
  await expect(animalHandle(page, 0)).toHaveAttribute('data-action', 'idle', { timeout: 9000 });
  await expectActionFinished(page, 1);
  await expectLiveState(page);
  await page.locator('button[data-actor-index="0"]').click();
  expect(await capture(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('all slide skins stay audible and bounded in a fast Trio and release after pause', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await openInstrument(page);
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator('#tempo').fill('1000');
  for (let index = 0; index < 3; index++) {
    await page.locator(`button[data-actor-index="${index}"]`).click();
    await page.locator('#behaviorSelect').selectOption('skid');
    await page.locator('[data-pace-ratio="3"]').click();
  }
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  const skins = await page.locator('#soundSkinSelect option').evaluateAll(options => options.map(option => option.value));
  for (const skin of skins) {
    await page.locator('#soundSkinSelect').selectOption(skin);
    // Sound skin is global; expire the old prepared horizon and its longest tail.
    await page.waitForTimeout(900);
    await expect.poll(async () => (await audioStatus(page)).rms).toBeGreaterThan(.0002);
    const status = await audioStatus(page);
    expect(status.peak, skin).toBeLessThan(.90);
    expect(status.clipped, skin).toBe(false);
  }
  await page.locator('#playButton').click();
  await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
  expect(errors).toEqual([]);
});


test('short actions finish on the clock when no animation frames are painted', async ({ page }) => {
  const errors = await openInstrument(page, { observed: true });
  await page.locator('#tempo').fill('1000');
  await page.locator('#audioButton').click();
  await page.evaluate(() => {
    globalThis.__quadrupedActionProbe.stopFrames();
    document.querySelector('[data-motion-action="slide"]').click();
  });
  await expect(actionButton(page, 'slide')).toHaveAttribute('data-active', 'true');
  await expect.poll(async () => (await probe(page)).actors[0].motion).toBeNull();
  await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
  await page.evaluate(() => globalThis.__quadrupedActionProbe.resumeFrames());
  await expectActionFinished(page);
  await expectLiveState(page, false, true);
  expect(errors).toEqual([]);
});
