import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from './helpers/fake-midi.mjs';

test.setTimeout(90000);
const snapshot = page => page.evaluate(() => window.roachSynth.getState());
async function loaded(page) {
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
  expect((await snapshot(page)).bones).toHaveLength(31);
}
async function openRoach(page) { await page.goto('roach-synth.html'); await loaded(page); }
async function choose(page, id, value) {
  const trigger = page.locator(`#${id}-picker-trigger`);
  if (await trigger.count()) {
    await trigger.click();
    await page.locator(`#${id}-picker-panel [data-value="${value}"]`).click();
  } else await page.locator(`#${id}`).selectOption(value);
}
async function settleScroll(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const position = () => scrollY + (document.querySelector('.roach-panel')?.scrollTop ?? 0);
    const deadline = performance.now() + 3000; let previous = position(), stableSince = performance.now();
    function check(now) {
      if (Math.abs(position() - previous) > .1) { previous = position(); stableSince = now; }
      if (now - stableSince >= 140) resolve();
      else if (now > deadline) reject(new Error('Touch scroll did not settle'));
      else requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }));
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
}

async function tapMainAudio(page, context) {
  const box = await page.locator('#audioButton').boundingBox();
  const viewport = page.viewportSize(), header = await page.locator('.masthead').boundingBox();
  expect(header.y).toBeGreaterThanOrEqual(-1); expect(header.y).toBeLessThanOrEqual(1);
  expect(box.y).toBeGreaterThanOrEqual(header.y); expect(box.y + box.height).toBeLessThanOrEqual(header.y + header.height + 1);
  expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

test('Audio and speech remain available while the specimen download is pending', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/roach-synth/cockroach-mobile.glb', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(new URL('roach-synth.html', baseURL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.roachSynth));
    expect((await snapshot(page)).loaded).toBe(false);
    await expect(page.locator('#soundPlayButton, #posePreset, #randomPose, #resetPose')).toHaveCount(0);
    await expect(page.locator('#motionButton')).toBeDisabled();
    await expect(page.locator('#liveStatus')).toContainText(/loading/i);
    await page.locator('#speakButton').tap();
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    await page.locator('#source-antennae').scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await tapMainAudio(page, context);
    await expect.poll(async () => (await snapshot(page)).audioOn).toBe(true);
    expect((await snapshot(page)).loaded).toBe(false);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.locator('#speakButton').tap();
    await expect.poll(async () => (await snapshot(page)).audio.speechEnvelope, { timeout: 12000 }).toBeGreaterThan(.0001);
    release(); await loaded(page);
    expect((await snapshot(page)).playing).toBe(false); expect((await snapshot(page)).audioOn).toBe(true);
    await page.locator('#motionButton').tap();
    expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).soundPlaying).toBe(true);
  } finally { release(); await context.close(); }
});

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`main Audio ${size.width}×${size.height} stays reachable while mixer controls scroll`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto(new URL('roach-synth.html', baseURL).href); await loaded(page);
      await page.locator('#motionButton').tap();
      expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
      await page.locator('#source-antennae').scrollIntoViewIfNeeded();
      const status = await page.locator('#liveStatus').boundingBox();
      await expect(page.locator('#liveStatus')).toContainText(/audio is off/i);
      expect(status.y).toBeGreaterThanOrEqual(0); expect(status.y + status.height).toBeLessThanOrEqual(size.height);
      const scroll = await page.evaluate(() => scrollY), before = await snapshot(page);
      await tapMainAudio(page, context);
      await expect.poll(async () => (await snapshot(page)).audioOn).toBe(true);
      await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.0001);
      const playing = await snapshot(page);
      expect(playing.playing).toBe(true); expect(playing.soundPlaying).toBe(true); expect(playing.time).toBeGreaterThan(before.time);
      expect(playing.camera).toEqual(before.camera); expect(await page.evaluate(() => scrollY)).toBe(scroll);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
      await tapMainAudio(page, context);
      await expect.poll(async () => (await snapshot(page)).audioOn).toBe(false);
      expect((await snapshot(page)).playing).toBe(true); expect(await page.evaluate(() => scrollY)).toBe(scroll);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    } finally { await context.close(); }
  });
}

test('index chooser opens the compact instrument with a held neutral body and Audio off', async ({ page }) => {
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('index.html');
  const chooser = page.locator('.instrument-picker');
  await chooser.locator('.instrument-picker-trigger').click();
  await chooser.getByRole('searchbox', { name: 'Filter instruments' }).fill('Roach');
  await chooser.locator('.instrument-picker-link[data-tool-id="roach-synth"]').first().click();
  await expect(page).toHaveURL(/roach-synth\.html$/); await loaded(page);
  const initial = await snapshot(page);
  expect(initial.playing).toBe(false); expect(initial.soundPlaying).toBe(false);
  expect(initial.audio.contextState).toBe('uninitialized');
  expect(initial.bones.every(joint => Object.values(joint.offset).every(value => value === 0))).toBe(true);
  await page.waitForTimeout(250);
  const held = await snapshot(page);
  expect(held.time).toBe(initial.time);
  expect(held.bones.map(joint => joint.quaternion)).toEqual(initial.bones.map(joint => joint.quaternion));
  expect(await page.evaluate(() => {
    const ids = ['header-preset-panel', 'motionButton', 'tempo', 'motionPreset', 'soundPreset', 'pitch', 'phrase', 'bodyMixer', 'midiPanic'];
    return ids.slice(1).every((id, i) => Boolean(document.getElementById(ids[i]).compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  expect(failures).toEqual([]);
});

test('graphic footer views, free orbit, wheel zoom and Fit preserve Audio and animation state', async ({ page }) => {
  await openRoach(page);
  const controls = page.locator('.roach-stage > .roach-view-controls');
  await expect(controls).toHaveCount(1);
  for (const id of ['viewPresets', 'sideToggle', 'resetCamera', 'zoomIn', 'zoomOut', 'dragAxis', 'showJoints', 'gestureInfo']) {
    await expect(controls.locator(`#${id}`)).toHaveCount(1);
  }
  expect(await controls.evaluate(element => Boolean(document.getElementById('specimenViewport').compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('#touch3D')).toHaveCount(0);
  const info = page.locator('#gestureInfo'), help = page.locator('#gestureHelp');
  await expect(info).toHaveAccessibleName(/help|gesture/i);
  await expect(info).toHaveAttribute('aria-controls', 'gestureHelp'); await expect(help).toBeHidden();
  await info.hover(); await expect(help).toBeVisible();
  const infoBox = await info.boundingBox(), helpBox = await help.boundingBox();
  await page.mouse.move(infoBox.x + infoBox.width / 2, helpBox.y + Math.min(8, helpBox.height / 2), { steps: 8 });
  await expect(help).toBeVisible();
  await page.mouse.move(0, 0); await expect(help).toBeHidden();
  await info.focus(); await expect(help).toBeVisible();
  await info.press('Escape'); await expect(help).toBeHidden();
  const cameras = [];
  for (const view of ['side', 'top', 'bottom', 'face']) {
    await page.locator(`[data-view="${view}"]`).click();
    const current = await snapshot(page); expect(current.camera.viewPreset).toBe(view); cameras.push(current.camera);
  }
  expect(new Set(cameras.map(camera => JSON.stringify(camera.quaternion))).size).toBe(4);
  expect(cameras[3].distance).toBeLessThan(cameras[0].distance);
  await page.locator('[data-view="side"]').click(); await page.locator('#sideToggle').click();
  const before = (await snapshot(page)).camera; expect(before.side).toBe('right');
  const canvas = page.locator('#roachCanvas'); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 18, box.y + 70); await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 90, { steps: 3 }); await page.mouse.up();
  expect((await snapshot(page)).camera.quaternion).not.toEqual(before.quaternion);
  expect((await snapshot(page)).camera.distance).toBe(before.distance);
  await page.locator('#zoomIn').click(); const near = (await snapshot(page)).camera.distance;
  expect(near).toBeLessThan(before.distance);
  await page.locator('#zoomOut').click(); expect((await snapshot(page)).camera.distance).toBeGreaterThan(near);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const wheelStart = (await snapshot(page)).camera.distance;
  await page.mouse.wheel(0, -150);
  await expect.poll(async () => (await snapshot(page)).camera.distance).toBeLessThan(wheelStart);
  const wheelNear = (await snapshot(page)).camera.distance;
  await page.mouse.wheel(0, 150);
  await expect.poll(async () => (await snapshot(page)).camera.distance).toBeGreaterThan(wheelNear);
  await page.locator('#resetCamera').click();
  const reset = (await snapshot(page)).camera;
  expect(reset.quaternion).toEqual(before.quaternion); expect(reset.distance).toBeCloseTo(before.distance, 7);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

test('animation routines and random motion switch live without selecting a camera or arming Audio', async ({ page }) => {
  await openRoach(page);
  const options = await page.locator('#motionPreset option').evaluateAll(items => items.map(item => item.value));
  expect(options.filter(id => id !== 'none' && id !== 'random')).toHaveLength(24);
  await page.locator('[data-view="top"]').click(); const camera = (await snapshot(page)).camera;
  await page.locator('#motionButton').click();
  await expect(page.locator('#motionButton .transport-pause')).toBeVisible();
  await expect(page.locator('#motionButton .transport-play')).toBeHidden();
  for (const id of ['side_walk', 'side_run', 'top_flight', 'dance_upright']) {
    await choose(page, 'motionPreset', id);
    const current = await snapshot(page);
    expect(current.playing).toBe(true); expect(current.view).toBe('top');
    expect(current.camera.quaternion).toEqual(camera.quaternion); expect(current.camera.distance).toBe(camera.distance);
  }
  const before = await snapshot(page); await page.locator('#randomMotion').click();
  const random = await snapshot(page);
  expect(random.playing).toBe(true); expect(random.time).toBeGreaterThanOrEqual(before.time);
  expect(random.motionSettings).not.toEqual(before.motionSettings); expect(random.camera).toEqual(before.camera);
  await page.locator('#randomMotion').click();
  expect((await snapshot(page)).motionSettings).not.toEqual(random.motionSettings);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await page.locator('#motionButton').click();
  await page.waitForTimeout(100); const paused = await snapshot(page);
  await page.waitForTimeout(180); const held = await snapshot(page);
  expect(held.time).toBe(paused.time); expect(held.bones.map(j => j.quaternion)).toEqual(paused.bones.map(j => j.quaternion));
  await expect(page.locator('#motionButton .transport-play')).toBeVisible();
});

test('circular Play starts and pauses animation and body sound while Audio remains independent', async ({ page }) => {
  await openRoach(page);
  const play = page.locator('#motionButton'), box = await play.boundingBox();
  expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  await play.click();
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).soundPlaying).toBe(true);
  await expect(play.locator('.transport-pause')).toBeVisible();
  await expect(play.locator('.transport-play')).toBeHidden();
  await arm(page); await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
  const started = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(started.time);
  await play.click();
  const stopped = await snapshot(page);
  expect(stopped.playing).toBe(false); expect(stopped.soundPlaying).toBe(false); expect(stopped.audioOn).toBe(true);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  await page.waitForTimeout(180); const held = await snapshot(page);
  expect(held.time).toBe(stopped.time); expect(held.bones.map(j => j.quaternion)).toEqual(stopped.bones.map(j => j.quaternion));
  await expect(play.locator('.transport-play')).toBeVisible();
  await play.click(); await page.locator('#audioButton').click();
  expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).soundPlaying).toBe(true);
  await waitForStableAudioState(page, false);
});

test('tempo actions multiply the displayed tempo and preserve pose, volume and playing state', async ({ page }) => {
  await openRoach(page);
  await page.locator('#tempo').fill('128');
  await page.locator('#level').fill('1');
  await expect(page.locator('#levelOut')).toHaveText('100%');
  await page.locator('#motionButton').click();
  const before = await snapshot(page);
  for (const [factor, tempo] of [['0.5', 64], ['0.25', 16], ['2', 32], ['4', 128]]) {
    await page.locator('#tempoScale').selectOption(factor);
    await expect(page.locator('#tempo')).toHaveValue(String(tempo));
    const current = await snapshot(page);
    expect(current.motionSettings.tempo).toBe(tempo);
    expect(current.playing).toBe(true); expect(current.soundPlaying).toBe(true);
    expect(current.sound.level).toBe(1); expect(current.camera).toEqual(before.camera);
    expect(current.audio.contextState).toBe('uninitialized');
  }
});

test('real worklet audio stays bounded and advances while graphics and UI are stalled', async ({ page }, testInfo) => {
  await openRoach(page); await page.locator('#motionButton').click();
  expect((await readAudioStatus(page)).active).toBe(false); await arm(page);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.clippedSamples).toBe(0);
  const before = await snapshot(page);
  await page.evaluate(() => { const end = performance.now() + 700; while (performance.now() < end) {} });
  await expect.poll(async () => (await snapshot(page)).audio.renderedFrames).toBeGreaterThan(before.audio.renderedFrames + 16000);
  const after = await snapshot(page); expect(after.time - before.time).toBeGreaterThan(.6);
  // Worklet status arrives through a queued message after the intentional UI
  // stall. Let that report catch up before comparing its clock to the live one.
  await expect.poll(async () => {
    const current = await snapshot(page);
    return Math.abs(current.audio.motionTime - current.time);
  }).toBeLessThan(.4);
  await testInfo.attach('roach-audio-thread.json', { body: JSON.stringify({ envelope: envelope.summary, before: before.audio, after: after.audio }), contentType: 'application/json' });
});

test('Say it speaks edited words while the body is held and does not arm Audio implicitly', async ({ page }) => {
  await openRoach(page);
  await expect(page.locator('#phrase')).toHaveValue("hi, I'm a cockroach and I live in your house");
  await expect(page.locator('#phrase')).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(page.locator('#speakButton')).toHaveText('Say it');
  await page.locator('#speakButton').click(); expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await arm(page); await page.locator('#phrase').fill('hello tiny robot bug');
  await page.locator('#phrase').press('Control+Enter');
  await expect.poll(async () => (await snapshot(page)).audio.speechEnvelope, { timeout: 12000 }).toBeGreaterThan(.0001);
  expect((await snapshot(page)).playing).toBe(false); expect((await snapshot(page)).soundPlaying).toBe(false);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001); expect(envelope.summary.clippedSamples).toBe(0);
});

test('MIDI input plays the selected body group without taking over either player', async ({ page }) => {
  await installFakeMidi(page); await openRoach(page); await enableFakeMidi(page);
  await sendMidi(page, MIDI_BYTES.noteOn(69, 100));
  await expect(page.locator('#midiStatus')).toContainText('Head');
  await expect.poll(async () => (await snapshot(page)).audio.midiFrequencies[6]).toBe(440);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.0001);
  await expect(page.locator('#motionButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await snapshot(page)).soundPlaying).toBe(false);
  expect((await snapshot(page)).selectedGroup).toBe('head');
  await sendMidi(page, MIDI_BYTES.noteOff(69));
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
});

test('failed specimen download preserves its poster and Retry loads all 31 joints', async ({ page }) => {
  await page.route('**/assets/roach-synth/cockroach-mobile.glb', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('roach-synth.html'); await expect(page.locator('#modelStatus')).toContainText('503');
  await expect(page.locator('#specimenImage')).toBeVisible(); await expect(page.locator('#roachCanvas')).toBeHidden();
  await page.unroute('**/assets/roach-synth/cockroach-mobile.glb'); await page.locator('#retryModel').click();
  await loaded(page); await expect(page.locator('#roachCanvas')).toBeVisible(); await expect(page.locator('#specimenImage')).toBeHidden();
});

test('direct part drags choose their body group and play while Play is paused', async ({ page }) => {
  await openRoach(page); await arm(page);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  for (const target of [{ view: 'face', joint: 'head', axis: 'x', group: 'head' }, { view: 'top', joint: 'wing_cover_left', axis: 'z', group: 'covers' }, { view: 'bottom', joint: 'middle_left_middle', axis: 'y', group: 'legs' }]) {
    await page.locator(`[data-view="${target.view}"]`).click(); await page.locator('#dragAxis').selectOption(target.axis);
    const point = await page.evaluate(joint => window.roachSynth.getPartScreenPosition(joint), target.joint);
    expect(point).not.toBeNull(); const before = await snapshot(page);
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    for (let step = 1; step <= 8; step++) { await page.mouse.move(point.x + step * 4, point.y - step); await page.waitForTimeout(35); }
    const moved = await snapshot(page);
    expect(moved.selectedBone).toBe(point.id); expect(moved.selectedGroup).toBe(target.group);
    expect(moved.camera).toEqual(before.camera);
    expect(moved.bones.find(part => part.id === point.id).offset).not.toEqual(before.bones.find(part => part.id === point.id).offset);
    expect(moved.audio.interactionPeak).toBeGreaterThan(.001);
    await page.mouse.up();
    expect((await snapshot(page)).playing).toBe(false); expect((await snapshot(page)).soundPlaying).toBe(false);
    await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  }
});

for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`mobile ${size.width}×${size.height} keeps graphic controls reachable beside or above scrollable parameters`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await page.goto(new URL('roach-synth.html', baseURL).href); await loaded(page);
      const stage = await page.locator('#specimenViewport').boundingBox();
      expect(stage.height).toBeGreaterThanOrEqual(size.width < size.height ? 230 : 170);
      const footer = await page.locator('.roach-stage > .roach-view-controls').boundingBox();
      expect(footer.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
      await page.locator('#source-head').scrollIntoViewIfNeeded();
      const scrollControl = await page.locator('#source-head').boundingBox();
      const scrollPosition = () => page.evaluate(() => scrollY + document.querySelector('.roach-panel').scrollTop);
      const initialScroll = await scrollPosition();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: scrollControl.x + scrollControl.width / 2, y: scrollControl.y + scrollControl.height / 2 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: scrollControl.x + scrollControl.width / 2, y: scrollControl.y + scrollControl.height / 2 - 80 * i / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(scrollPosition).toBeGreaterThan(initialScroll + 20);
      await settleScroll(page);
      await expect.poll(async () => {
        const currentStage = await page.locator('#specimenViewport').boundingBox(), header = await page.locator('.masthead').boundingBox();
        return Math.abs(currentStage.y - header.y - header.height);
      }).toBeLessThanOrEqual(1);
      for (const selector of ['.header-preset-picker summary', '.header-preset-next', '.header-preset-random', '#motionButton', '#tempo', '#tempoScale', '#phrase', '#motionPreset-picker-trigger', '#soundPreset-picker-trigger', '#source-antennae', '#crunch', '#midiPanic']) {
        await page.locator(selector).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
        const box = await page.locator(selector).boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
        const currentStage = await page.locator('#specimenViewport').boundingBox();
        if (size.width < size.height) {
          const currentFooter = await page.locator('.roach-stage > .roach-view-controls').boundingBox();
          expect(box.y).toBeGreaterThanOrEqual(currentFooter.y + currentFooter.height - 1);
        } else {
          expect(box.x).toBeGreaterThanOrEqual(currentStage.x + currentStage.width - 1);
          expect(box.y).toBeGreaterThanOrEqual((await page.locator('.masthead').boundingBox()).height - 1);
        }
        expect(await page.locator(selector).evaluate(element => {
          const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return element.contains(hit) || Boolean(element.closest('label')?.contains(hit));
        })).toBe(true);
      }
      const info = page.locator('#gestureInfo'), help = page.locator('#gestureHelp');
      await page.locator('[data-view=side]').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.locator('[data-view=side]').tap(); expect((await snapshot(page)).camera.viewPreset).toBe('side');
      await info.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' })); await info.tap(); await expect(help).toBeVisible();
      const helpBox = await help.boundingBox();
      expect(helpBox.x).toBeGreaterThanOrEqual(0); expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(size.width + 1);
      expect(helpBox.y).toBeGreaterThanOrEqual(0); expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(size.height + 1);
      await info.tap(); await expect(help).toBeHidden();
      for (const row of await page.locator('.roach-body-row').all()) {
        const box = await row.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      for (const selector of ['#audioButton', '#motionButton']) {
        const box = await page.locator(selector).boundingBox(); expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
      }
      expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    } finally { await context.close(); }
  });
}


test('full presets, Next and dice animate every scene without changing volume or arming Audio', async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 390, height: 844 });
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await openRoach(page);
  await page.locator('#level').fill('0.42'); await page.locator('#voice').fill('0.33');
  const camera = (await snapshot(page)).camera;
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'unselected');
  const ids = await page.locator('[data-full-preset]').evaluateAll(buttons => buttons.map(button => button.dataset.presetId));
  expect(ids).toHaveLength(24);
  await page.locator('.header-preset-picker summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${ids[0]}"]`).click();
  for (const [index, id] of ids.entries()) {
    if (index) await page.locator('.header-preset-next').click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', id);
    const state = await snapshot(page);
    expect(state.playing).toBe(true); expect(state.motionSettings.antennae).toBe(true);
    expect(state.sound.level).toBe(.42); expect(state.sound.voice).toBe(.33);
    expect(state.audio.contextState).toBe('uninitialized'); expect(state.camera).toEqual(camera);
  }
  await page.locator('#motionButton').click(); expect((await snapshot(page)).playing).toBe(false);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', ids[0]);
  expect((await snapshot(page)).playing).toBe(true);
  await page.locator('.header-preset-next').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', ids[1]);
  expect((await snapshot(page)).motionChoice).toBe(ids[1]);
  await arm(page);
  const before = await snapshot(page);
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  const random = await snapshot(page);
  expect(random.playing).toBe(true); expect(random.soundPlaying).toBe(true); expect(random.audioOn).toBe(true);
  expect(random.sound.level).toBe(.42); expect(random.sound.voice).toBe(.33);
  expect(random.time).toBeGreaterThanOrEqual(before.time); expect(random.camera).toEqual(camera);
  expect(random.motionSettings.antennae).toBe(true);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.0001);
  expect(failures).toEqual([]);
});

test('Roach logo and catalogue instrument information finish the parameter panel', async ({ page }) => {
  await openRoach(page);
  const info = page.locator('.roach-panel > .instrument-page-info[data-tool-id="roach-synth"]');
  await expect(info).toHaveCount(1);
  expect(await info.evaluate(element => element.parentElement.lastElementChild === element)).toBe(true);
  await expect(info.locator('.instrument-picker-card-title')).toHaveText('Roach Synth');
  await expect(info.locator('.instrument-picker-card-image')).toHaveAttribute('src', /roach-synth\.webp/);
  await expect(info.locator('.instrument-picker-card-description')).not.toBeEmpty();
});
