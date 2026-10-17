import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from './helpers/fake-midi.mjs';

test.setTimeout(90000);
// Compositor recording can outlast short speech and stalls on software WebGL.
// Keep API/source traces; timing cases also attach bounded numeric evidence.
test.use({ trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true }, video: 'off' });
const snapshot = page => page.evaluate(() => window.roachSynth.getState());
async function loaded(page) {
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
  expect((await snapshot(page)).bones).toHaveLength(31);
}
async function openRoach(page) { await page.goto('roach-synth.html'); await loaded(page); }
async function settleScroll(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const deadline = performance.now() + 3000; let previous = scrollY, stableSince = performance.now();
    function check(now) {
      if (Math.abs(scrollY - previous) > .1) { previous = scrollY; stableSince = now; }
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

test('optional Drone and the main Audio button work while the specimen download is still pending', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/roach-synth/cockroach-mobile.glb', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(new URL('roach-synth.html', baseURL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.roachSynth));
    expect((await snapshot(page)).loaded).toBe(false);
    await expect(page.locator('#soundPlayButton')).toBeEnabled(); await expect(page.locator('#motionButton')).toBeDisabled();
    await expect(page.locator('#liveStatus')).toContainText(/loading/i);
    await page.locator('#soundPlayButton').tap();
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    await page.locator('#source-antennae').scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await tapMainAudio(page, context);
    await expect.poll(async () => (await snapshot(page)).audioOn).toBe(true);
    await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.0001);
    expect((await snapshot(page)).loaded).toBe(false);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    release(); await loaded(page);
    expect((await snapshot(page)).soundPlaying).toBe(true); expect((await snapshot(page)).audioOn).toBe(true);
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
      expect(playing.playing).toBe(true); expect(playing.soundPlaying).toBe(false); expect(playing.time).toBeGreaterThan(before.time);
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
    const ids = ['header-preset-panel', 'motionButton', 'soundPreset', 'phrase', 'soundPlayButton', 'bodyMixer', 'midiPanic'];
    return ids.slice(1).every((id, i) => Boolean(document.getElementById(ids[i]).compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  expect(failures).toEqual([]);
});

test('four anatomical views, free orbit, explicit zoom buttons and keyboard fit keep distinct ownership', async ({ page }) => {
  await openRoach(page);
  const controls = page.locator('.roach-panel > .roach-view-controls');
  await expect(controls).toHaveCount(1);
  for (const id of ['viewPresets', 'sideToggle', 'resetCamera', 'zoomIn', 'zoomOut', 'dragAxis', 'touch3D', 'showJoints', 'gestureInfo']) {
    await expect(controls.locator(`#${id}`)).toHaveCount(1);
  }
  expect(await controls.evaluate(element => Boolean(document.getElementById('phrase').compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
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
  await canvas.focus(); await page.keyboard.press('+');
  expect((await snapshot(page)).camera.distance).toBeLessThan(before.distance);
  await page.locator('#resetCamera').click();
  const reset = (await snapshot(page)).camera;
  expect(reset.quaternion).toEqual(before.quaternion); expect(reset.distance).toBeCloseTo(before.distance, 7);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

test('animation routines and random motion switch live without selecting a camera or arming Audio', async ({ page }) => {
  await openRoach(page);
  const options = await page.locator('#motionPreset option').evaluateAll(items => items.map(item => item.value));
  expect(options.filter(id => id !== 'none' && id !== 'random')).toHaveLength(48);
  expect(options.filter(id => id.startsWith('pose:'))).toHaveLength(24);
  await expect(page.locator('#posePreset, #randomPose, #previousMotion')).toHaveCount(0);
  await page.locator('[data-view="top"]').click(); const camera = (await snapshot(page)).camera;
  await page.locator('#motionButton').click();
  await expect(page.locator('#motionButton .transport-pause')).toBeVisible();
  await expect(page.locator('#motionButton .transport-play')).toBeHidden();
  for (const id of ['side_walk', 'side_run', 'top_flight', 'dance_upright', 'pose:boxer_guard', 'pose:wings_spread']) {
    await page.locator('#motionPreset').selectOption(id);
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

test('optional Drone, Animation Play and explicit Audio remain independent with visible pause icons', async ({ page }) => {
  await openRoach(page); await page.locator('#soundPlayButton').click();
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await expect(page.locator('#soundPlayButton .transport-pause')).toBeVisible();
  await expect(page.locator('#soundPlayButton .transport-play')).toBeHidden();
  await arm(page); await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
  const started = await snapshot(page); await page.waitForTimeout(180); const held = await snapshot(page);
  expect(held.time).toBe(started.time); expect(held.bones.map(j => j.quaternion)).toEqual(started.bones.map(j => j.quaternion));
  await page.locator('#motionPreset').selectOption('pose:boxer_guard'); const selected = await snapshot(page);
  expect(selected.playing).toBe(false); expect(selected.soundPlaying).toBe(true);
  expect(selected.motionChoice).toBe('pose:boxer_guard');
  expect(selected.bones.map(j => j.quaternion)).not.toEqual(held.bones.map(j => j.quaternion));
  await page.locator('#resetPose').click();
  expect((await snapshot(page)).bones.every(j => Object.values(j.offset).every(value => value === 0))).toBe(true);
  await page.locator('#motionButton').click(); await page.locator('#soundPlayButton').click();
  expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).soundPlaying).toBe(false);
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  await page.locator('#motionButton').click(); await page.locator('#audioButton').click();
  expect((await snapshot(page)).playing).toBe(true); await waitForStableAudioState(page, false);
});

test('real worklet audio stays bounded and advances while graphics and UI are stalled', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    // Keep the actual instrument context for timestamp-aligned observation.
    window.roachTestAudioContexts = [];
    const Context = window.AudioContext;
    window.AudioContext = new Proxy(Context, { construct(Target, args) {
      const context = Reflect.construct(Target, args);
      window.roachTestAudioContexts.push(context); return context;
    } });
  });
  await openRoach(page); await page.locator('#motionButton').click();
  expect((await readAudioStatus(page)).active).toBe(false); await arm(page);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.clippedSamples).toBe(0);
  const before = await snapshot(page);
  await page.evaluate(() => { const end = performance.now() + 700; while (performance.now() < end) {} });
  await expect.poll(async () => (await snapshot(page)).audio.renderedFrames).toBeGreaterThan(before.audio.renderedFrames + 16000);
  const after = await snapshot(page); expect(after.time - before.time).toBeGreaterThan(.6);
  // Worklet reports are queued during the intentional UI stall. Compare both
  // clocks at the same AudioContext time, retaining the original drift limit.
  // The report's audioTime is the block start; motionTime includes that block.
  const clock = await page.evaluate(() => {
    const state = window.roachSynth.getState(), context = window.roachTestAudioContexts[0];
    const deliveryAge = context.currentTime - state.audio.audioTime;
    return { contextTime: context.currentTime, reportTime: state.audio.audioTime,
      deliveryAge, rawLag: state.time - state.audio.motionTime,
      error: Math.abs(state.time - (state.audio.motionTime + deliveryAge)) };
  });
  expect(clock.error).toBeLessThan(.4);
  await testInfo.attach('roach-audio-thread.json', { body: JSON.stringify({ envelope: envelope.summary, before: before.audio, after: after.audio, clock }), contentType: 'application/json' });
});

test('Say it speaks edited words while the body is held and does not arm Audio implicitly', async ({ page }, testInfo) => {
  await openRoach(page);
  await expect(page.locator('#phrase')).toHaveValue("hi, I'm a cockroach and I live in your house");
  await expect(page.locator('#phrase')).toHaveJSProperty('tagName', 'TEXTAREA');
  await expect(page.locator('#speakButton')).toHaveText('Say it');
  await page.locator('#speakButton').click(); expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await arm(page); await page.locator('#phrase').fill('hello tiny robot bug');
  // Observe in the page before the real shortcut: a round trip after detecting
  // onset can miss this one-second phrase entirely on a busy renderer.
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import(new URL('src/audio-output-manager.js', `${location.origin}/`).href);
    const manager = getSharedAudioOutputManager(globalThis);
    window.roachShortcutSpeech = new Promise(resolve => {
      document.getElementById('phrase').addEventListener('keydown', function observe(event) {
        if (!(event.ctrlKey && event.key === 'Enter')) return;
        this.removeEventListener('keydown', observe, true);
        const samples = [], start = performance.now(); let quietSince = null, heard = false;
        function sample() {
          const state = window.roachSynth.getState(), output = manager.getStatus(), now = performance.now();
          samples.push({ elapsedMs: now - start, envelope: state.audio.speechEnvelope,
            peak: output.peak, clipped: output.clipped, playing: state.playing, soundPlaying: state.soundPlaying });
          heard ||= state.audio.speechEnvelope > .0001;
          if (heard && state.audio.speechEnvelope < .0001) quietSince ??= now; else quietSince = null;
          if ((quietSince !== null && now - quietSince >= 500) || now - start >= 12000) resolve(samples);
          else setTimeout(sample, 40);
        }
        sample();
      }, true);
    });
  });
  await page.locator('#phrase').press('Control+Enter');
  const samples = await page.evaluate(() => window.roachShortcutSpeech);
  expect(Math.max(...samples.map(sample => sample.envelope))).toBeGreaterThan(.0001);
  expect(samples.every(sample => !sample.playing && !sample.soundPlaying)).toBe(true);
  expect(samples.every(sample => Number.isFinite(sample.peak))).toBe(true);
  expect(Math.max(...samples.map(sample => sample.peak))).toBeGreaterThan(.001);
  expect(samples.filter(sample => sample.clipped)).toHaveLength(0);
  await testInfo.attach('keyboard-native-speech.json', { body: JSON.stringify(samples), contentType: 'application/json' });
});

test('MIDI input plays the selected body group without taking over either player', async ({ page }) => {
  await installFakeMidi(page); await openRoach(page); await enableFakeMidi(page);
  await sendMidi(page, MIDI_BYTES.noteOn(69, 100));
  await expect(page.locator('#midiStatus')).toContainText('Head');
  await expect.poll(async () => (await snapshot(page)).audio.midiFrequencies[6]).toBe(440);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.0001);
  await expect(page.locator('#motionButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#soundPlayButton')).toHaveAttribute('aria-pressed', 'false');
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

test('direct part drags choose their body group and play while animation and Sound Play are paused', async ({ page }) => {
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
  test(`mobile ${size.width}×${size.height} keeps a fixed stage, independently scrollable controls and fitting body rows`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await page.goto(new URL('roach-synth.html', baseURL).href); await loaded(page);
      const stage = await page.locator('#specimenViewport').boundingBox();
      expect(stage.height).toBeGreaterThanOrEqual(size.width < size.height ? 300 : 170);
      const initialStage = { ...stage };
      const panel = page.locator('.roach-panel');
      await panel.evaluate(element => { element.scrollTop = 200; });
      expect(await page.evaluate(() => scrollY)).toBe(0);
      expect(await page.locator('#specimenViewport').boundingBox()).toEqual(initialStage);
      for (const selector of ['.header-preset-picker summary', '.header-preset-next', '.header-preset-random', '[data-view=side]', '#dragAxis', '#nextMotion', '#randomMotion', '#nextSound', '#randomSound', '#phrase', '#motionPreset', '#source-antennae', '#crunch', '#midiPanic']) {
        await page.locator(selector).evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
        const box = await page.locator(selector).boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
        const currentPanel = await panel.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(currentPanel.y - 1);
        expect(box.x).toBeGreaterThanOrEqual(currentPanel.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(currentPanel.x + currentPanel.width + 1);
        expect(await page.locator('#specimenViewport').boundingBox()).toEqual(initialStage);
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
      const drone = await page.locator('#soundPlayButton').boundingBox(); expect(drone.width).toBeGreaterThanOrEqual(44); expect(drone.height).toBeGreaterThanOrEqual(44);
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
  expect(ids).toHaveLength(48);
  await page.locator('.header-preset-picker summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${ids[0]}"]`).click();
  for (const [index, id] of ids.entries()) {
    if (index) await page.locator('.header-preset-next').click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', id);
    const state = await snapshot(page);
    expect(state.playing).toBe(true); expect(state.motionSettings.antennae).toBe(true);
    expect(state.sound.level).toBe(.42); expect(state.sound.voice).toBe(.33);
    expect(state.audio.contextState).toBe('uninitialized');
    expect(['side', 'top', 'bottom', 'face']).toContain(state.view); expect(state.camera.viewPreset).toBe(state.view);
  }
  await page.locator('#motionButton').click(); expect((await snapshot(page)).playing).toBe(false);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', ids[0]);
  expect((await snapshot(page)).playing).toBe(true);
  await page.locator('.header-preset-next').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', ids[1]);
  expect((await snapshot(page)).motionChoice).toBe(ids[1]);
  await page.locator('#soundPlayButton').click(); await arm(page);
  const before = await snapshot(page);
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  const random = await snapshot(page);
  expect(random.playing).toBe(true); expect(random.soundPlaying).toBe(true); expect(random.audioOn).toBe(true);
  expect(random.sound.level).toBe(.42); expect(random.sound.voice).toBe(.33);
  expect(random.time).toBeGreaterThanOrEqual(before.time); expect(['side', 'top', 'bottom', 'face']).toContain(random.view);
  expect(random.camera.viewPreset).toBe(random.view);
  expect(random.motionSettings.antennae).toBe(true);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.0001);
  expect(failures).toEqual([]);
});
