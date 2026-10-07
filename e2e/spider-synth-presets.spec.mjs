import { expect, test } from '@playwright/test';

test.setTimeout(120000);
const state = page => page.evaluate(() => window.spiderSynth.getState());
const preset = page => page.evaluate(async () => (await import('./src/site/header-presets.js')).captureHeaderPresetState());
async function open(page) {
  await page.goto('spider-synth.html');
  await page.waitForFunction(() => window.spiderSynth?.getState().loaded, undefined, { timeout: 45000 });
}
async function choose(page, id) {
  await page.locator('.header-preset-picker summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect.poll(async () => (await preset(page)).selectedId, { timeout: 30000 }).toBe(id);
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
}

test('24 full scenes recall exactly; Next wraps, Dice creates Custom, and live controls survive', async ({ page }, testInfo) => {
  // The complete tour loads six scans while all 24 animations are running.
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Preset not loaded|Parameters not randomized/.test(message.text())) errors.push(message.text()); });
  await open(page);
  await expect(page.locator('#soundPlayButton, #posePreset, #randomPose, #resetPose')).toHaveCount(0);
  expect(await page.locator('[data-instrument-preset-host]').evaluate(host => host.firstElementChild.matches('.header-preset-controls'))).toBe(true);
  const bank = await page.evaluate(async () => (await import('./src/instruments/spider-synth/spider-synth-presets.js')).SPIDER_FULL_PRESETS);
  expect(bank).toHaveLength(24); expect((await preset(page)).selectedId).toBe(null);
  expect((await state(page)).playing).toBe(false); expect((await state(page)).audioOn).toBe(false);
  let previousTime = 0;
  await setRange(page, 'level', .57); await setRange(page, 'voice', .31);
  await page.locator('#phrase').fill('This text belongs to the performer.');
  for (const scene of bank) {
    await page.locator('.header-preset-next').click();
    await expect.poll(async () => (await preset(page)).selectedId, { timeout: 30000 }).toBe(scene.id);
    expect((await preset(page)).snapshot).toEqual(scene.snapshot);
    const current = await state(page);
    expect(current.audioOn).toBe(false); expect(current.playing).toBe(true);
    expect(current.time).toBeGreaterThanOrEqual(previousTime); previousTime = current.time;
    expect(current.sound.level).toBe(.57); expect(current.sound.voice).toBe(.31); expect(current.soundPlaying).toBe(false);
  }
  await page.locator('.header-preset-next').click();
  await expect.poll(async () => (await preset(page)).selectedId, { timeout: 30000 }).toBe(bank[0].id);
  await page.locator('#motionButton').click();
  expect((await state(page)).playing).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await state(page)).audio.contextState).toBe('running');
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.0001);
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(1);
  const before = await state(page);
  await choose(page, bank[4].id);
  const running = await state(page);
  expect(running.playing).toBe(true); expect(running.audioOn).toBe(true); expect(running.time).toBeGreaterThanOrEqual(before.time);
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom', { timeout: 30000 });
  const randomized = await preset(page), after = await state(page);
  expect(bank.some(scene => JSON.stringify(scene.snapshot) === JSON.stringify(randomized.snapshot))).toBe(false);
  expect(after.playing).toBe(true); expect(after.audioOn).toBe(true); expect(after.time).toBeGreaterThanOrEqual(running.time);
  expect(after.sound.level).toBe(.57); expect(after.sound.voice).toBe(.31);
  await expect(page.locator('#phrase')).toHaveValue('This text belongs to the performer.');
  await page.locator('#motionButton').click();
  await choose(page, bank[1].id);
  await setRange(page, 'tension', 1.73);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  await choose(page, bank[1].id); expect((await preset(page)).snapshot).toEqual(bank[1].snapshot);
  await page.screenshot({ path: testInfo.outputPath('spider-presets-desktop.png') });
  expect(errors).toEqual([]);
});

test('a failed preset skin load rolls the complete musical scene back', async ({ page }) => {
  await open(page); await choose(page, 'argiope-2');
  await page.locator('#motionButton').click();
  expect((await state(page)).playing).toBe(false);
  const before = await preset(page);
  await page.route('**/skins/golden/spider-*.glb*', route => route.abort('failed'));
  await page.locator('.header-preset-picker summary').click();
  await page.locator('[data-full-preset][data-preset-id="golden-1"]').click();
  await expect(page.locator('.header-preset-controls [role="status"]')).toContainText('Preset not loaded', { timeout: 30000 });
  expect(await preset(page)).toEqual(before);
  const after = await state(page);
  expect(after.loaded).toBe(true); expect(after.specimen).toBe('argiope'); expect(after.audioOn).toBe(false);
  expect(after.playing).toBe(false); await expect(page.locator('#motionButton')).toHaveAttribute('aria-pressed', 'false');
});

test('pending scene recall keeps skin selection owned until the load finishes', async ({ page }) => {
  await open(page); let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/skins/golden/spider-*.glb*', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.locator('.header-preset-picker summary').click();
    await page.locator('[data-full-preset][data-preset-id="golden-1"]').click();
    await expect(page.locator('#specimenPreset')).toBeDisabled();
    expect((await state(page)).audioOn).toBe(false); expect((await state(page)).playing).toBe(false);
    release();
    await expect.poll(async () => (await preset(page)).selectedId, { timeout: 30000 }).toBe('golden-1');
    await expect(page.locator('#specimenPreset')).toBeEnabled();
    expect((await state(page)).playing).toBe(true); expect((await state(page)).audioOn).toBe(false);
  } finally { release(); }
});

test('held mouse strums multiple strings and reverse strokes without orbit or a release attack', async ({ page }) => {
  await open(page);
  const points = await page.evaluate(() => {
    const api = window.spiderSynth, rect = document.querySelector('#spiderCanvas').getBoundingClientRect();
    const candidates = [];
    for (let id = 200; id < api.getState().web.segments; id++) {
      const p = api.getSegmentScreenPosition(id, .5);
      if (p?.visible && p.x > rect.left + rect.width / 2 + 60 && p.x < rect.right - 35 && p.y > rect.top + 60 && p.y < rect.bottom - 60) candidates.push(p);
    }
    const from = candidates.sort((a, b) => b.x - a.x)[0];
    return { from, to: { x: rect.left + 40, y: from?.y } };
  });
  expect(points.from).toBeTruthy();
  const camera = (await state(page)).camera;
  await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
  await page.mouse.move(points.to.x, points.to.y); await page.mouse.up();
  expect((await state(page)).audio.contextState).toBe('uninitialized');
  expect((await state(page)).camera).toEqual(camera);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await state(page)).audio.contextState).toBe('running');
  await expect.poll(async () => (await state(page)).audio.pluckEvents).toBe(0);
  const before = (await state(page)).audio.pluckEvents;
  await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
  await page.mouse.move(points.to.x, points.to.y);
  await expect.poll(async () => (await state(page)).audio.pluckEvents).toBeGreaterThan(before + 5);
  const outward = (await state(page)).audio.pluckEvents;
  await page.mouse.move(points.from.x, points.from.y);
  await expect.poll(async () => (await state(page)).audio.pluckEvents).toBeGreaterThan(outward + 5);
  const back = (await state(page)).audio.pluckEvents;
  await page.mouse.up(); await page.waitForTimeout(180);
  expect((await state(page)).audio.pluckEvents).toBe(back);
  expect((await state(page)).camera).toEqual(camera);
  expect((await state(page)).playing).toBe(false); expect((await state(page)).soundPlaying).toBe(false);
  // A browser may deliver a fast out-and-back motion in one coalesced event.
  // Its final position alone is still inside the original click threshold.
  await page.mouse.move(points.from.x, points.from.y); await page.mouse.down();
  await page.evaluate(({ from, to }) => {
    const canvas = document.querySelector('#spiderCanvas'), time = performance.now();
    const event = new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: from.x + 1, clientY: from.y });
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => [
      { clientX: to.x, clientY: to.y, timeStamp: time - 10 },
      { clientX: from.x + 1, clientY: from.y, timeStamp: time },
    ] });
    canvas.dispatchEvent(event);
  }, points);
  await expect.poll(async () => (await state(page)).audio.pluckEvents).toBeGreaterThan(back + 10);
  await page.mouse.up();
});

for (const [label, viewport, mobile] of [
  ['desktop', { width: 1440, height: 900 }, false],
  ['phone portrait', { width: 390, height: 844 }, true],
  ['phone landscape', { width: 844, height: 390 }, true],
]) test(`Animation and Fly are below presets; every preset action resumes animation on ${label}`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  try {
    await open(page);
    expect((await state(page)).playing).toBe(false); expect((await state(page)).audioOn).toBe(false);
    const order = await page.locator('[data-instrument-preset-host]').evaluate(host => {
      const children = [...host.children];
      return [children[0].matches('.header-preset-controls'), children[1].matches('.spider-performance'), children[2].matches('.spider-fly-controls')];
    });
    expect(order).toEqual([true, true, true]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Exercise the real dropdown, Next and Dice from paused state. Their programmatic
    // transactions may animate, but must never create an AudioContext or arm sound.
    await choose(page, 'argiope-2');
    await expect(page.locator('#motionButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#motionButton').click();
    await page.locator('.header-preset-next').click();
    await expect.poll(async () => (await preset(page)).selectedId).toBe('argiope-3');
    await expect(page.locator('#motionButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#motionButton').click();
    await page.locator('.header-preset-random').click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom', { timeout: 30000 });
    const after = await state(page);
    expect(after.playing).toBe(true); expect(after.audioOn).toBe(false); expect(after.soundPlaying).toBe(false);
    expect(after.audio.contextState).toBe('uninitialized');
    for (const selector of ['#motionButton', '#catchBug', '#huntBug', '#flyOnSelect']) {
      const control = page.locator(selector);
      await control.evaluate(element => {
        element.scrollIntoView({ block: 'end', behavior: 'instant' });
        // Generated WAX pages have a fixed host strip at the bottom. Scroll
        // above it, just as a performer would, before checking hit ownership.
        const footer = document.querySelector('.wax-midi-panel')?.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        if (footer && box.right > footer.left && box.bottom > footer.top - 8) {
          const distance = box.bottom - footer.top + 8;
          let scroller = element.parentElement;
          while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
          if (scroller) scroller.scrollTop += distance;
          else window.scrollBy(0, distance);
        }
      });
      await expect(control).toBeInViewport();
      // The sticky mobile canvas must not cover the control's center.
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return target === element || element.contains(target);
      }), selector).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`spider-scene-controls-${label.replaceAll(' ', '-')}.png`) });
  } finally { await context.close(); }
});

test('a weaving scene moves across the web, creates visible new silk, and pauses its route', async ({ page }) => {
  await open(page); await choose(page, 'argiope-1');
  const initial = await state(page), origin = initial.frame.body;
  expect(initial.worldSettings.path).not.toBe('hold'); expect(initial.worldSettings.laySilk).toBe(true);
  await expect.poll(async () => {
    const body = (await state(page)).frame.body;
    return Math.hypot(body.x - origin.x, body.z - origin.z);
  }, { timeout: 12000, intervals: [100, 200, 300] }).toBeGreaterThan(.1);
  await expect.poll(async () => (await state(page)).world.silkSegments.length, { timeout: 12000 }).toBeGreaterThan(initial.world.silkSegments.length + 5);
  expect(await page.evaluate(() => {
    const api = window.spiderSynth;
    return api.getState().world.silkSegments.some(strand => api.getSilkScreenPosition(strand.id, .5)?.visible);
  })).toBe(true);
  await page.locator('#motionButton').click();
  // Allow the frame that receives the pause to flush its final silk tick.
  await page.waitForTimeout(300);
  const paused = await state(page);
  await page.waitForTimeout(500);
  const settled = await state(page);
  expect(settled.playing).toBe(false); expect(settled.audioOn).toBe(false);
  expect(settled.time).toBeCloseTo(paused.time, 5);
  expect(settled.world.silkSegments.length).toBe(paused.world.silkSegments.length);
  expect(Math.hypot(settled.frame.body.x - paused.frame.body.x, settled.frame.body.z - paused.frame.body.z)).toBeLessThan(.002);
});

test('a roaming scene moves away from its start without laying silk', async ({ page }) => {
  await open(page); await choose(page, 'huntsman-3');
  const initial = await state(page), origin = initial.frame.body;
  expect(initial.worldSettings.path).not.toBe('hold'); expect(initial.worldSettings.laySilk).toBe(false);
  await expect.poll(async () => {
    const body = (await state(page)).frame.body;
    return Math.hypot(body.x - origin.x, body.z - origin.z);
  }, { timeout: 12000, intervals: [100, 200, 300] }).toBeGreaterThan(.1);
  expect((await state(page)).world.silkSegments).toHaveLength(0);
  expect((await state(page)).audioOn).toBe(false);
});

test('fly scenes send one fly on recall; editing the option does not send another', async ({ page }) => {
  await open(page);
  expect((await state(page)).world.prey).toHaveLength(0);
  await choose(page, 'argiope-4');
  await expect(page.locator('#flyOnSelect')).toBeChecked();
  await expect.poll(async () => (await state(page)).world.prey.length).toBe(1);
  const first = (await state(page)).world.prey[0].id;
  await expect.poll(async () => (await state(page)).world.prey[0]?.state).toBe('trapped');
  expect((await state(page)).audioOn).toBe(false);
  await page.locator('#flyOnSelect').uncheck();
  await page.locator('#flyOnSelect').check();
  expect((await state(page)).world.prey.map(prey => prey.id)).toEqual([first]);
  // Recalling the same graph must make the one-shot action run once again.
  await choose(page, 'argiope-4');
  await expect.poll(async () => (await state(page)).world.prey.length).toBe(2);
  expect((await state(page)).world.prey[1].id).toBeGreaterThan(first);
  await page.waitForTimeout(500);
  expect((await state(page)).world.prey).toHaveLength(2);
  // A different skin/topology must keep its newly sent fly, not clear it while
  // the visual world and worklet receive the replacement web.
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await state(page)).audio.contextState).toBe('running');
  await choose(page, 'huntsman-1');
  await expect.poll(async () => (await state(page)).world.prey.length).toBe(1);
  await expect.poll(async () => (await state(page)).world.prey[0]?.state).toBe('trapped');
  expect((await state(page)).audioOn).toBe(true);
});
