import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.setTimeout(90000);
// Short phrases need their audio/motion observations ahead of compositor work.
// Keep API/source traces and the continuous frame artifact; stage screenshots
// have separate UI coverage.
test.use({ video: 'off', trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false, sources: true } });
test.afterEach(async ({ page }, testInfo) => {
  const proof = await page.evaluate(() => {
    const probe = window.__roachSpeechProbe;
    if (!probe) return null;
    probe.stop();
    return { startedAt: probe.startedAt, firstVoicedAt: probe.firstVoicedAt, action: probe.action, actionError: probe.actionError, frames: probe.frames };
  }).catch(() => null);
  if (proof) {
    const path = testInfo.outputPath('continuous-speech-observations.json');
    await writeFile(path, JSON.stringify(proof));
    await testInfo.attach('continuous-speech-observations.json', { path, contentType: 'application/json' });
  }
});
const snapshot = page => page.evaluate(() => window.roachSynth.getState());
const quaternions = state => state.bones.map(bone => [bone.id, ...bone.quaternion]);
const offsets = state => state.bones.map(bone => ({ id: bone.id, offset: bone.offset }));
const head = state => state.bones.find(bone => bone.jointId === 'head').quaternion;
const players = state => ({ animation: state.playing, sound: state.soundPlaying });
const longPhrase = 'hello little cockroach, I live in your house and I have a very long story to tell you';

async function open(page) {
  // Observe the pose that is about to be drawn. A later timer can see a newer
  // speech scalar while the displayed joints still belong to the prior frame.
  await page.route('**/src/instruments/roach-synth/roach-synth-viewer.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = '      renderer.render(scene, camera);';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `      if (globalThis.__roachSpeechProbe?.active) globalThis.__roachSpeechProbe.tick('draw');\n${marker}`) });
  });
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
  expect((await snapshot(page)).bones).toHaveLength(31);
  await expect(page.locator('[data-full-preset]')).toHaveCount(48);
  const count = (await snapshot(page)).renderCount;
  await page.locator('[data-view="face"]').click();
  await expect.poll(async () => (await snapshot(page)).renderCount).toBeGreaterThan(count);
}
async function press(page, selector, touch = false) {
  const target = page.locator(selector);
  await target.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  if (touch) await target.tap(); else await target.click();
}
async function arm(page, touch = false) {
  await press(page, '#audioButton', touch);
  await expect.poll(async () => (await snapshot(page)).audioOn).toBe(true);
  await expect.poll(async () => (await snapshot(page)).audio.ready).toBe(true);
}
// Observe before the real UI gesture. Trace screenshots and slow software 3D
// rendering can delay the next browser command until the native phrase ends.
async function observeSpeech(page, action = null) {
  await page.evaluate(action => {
    window.__roachSpeechProbe?.stop();
    const probe = { frames: [], startedAt: null, firstVoicedAt: null, action: null, actionError: null, timer: null, active: false };
    let deadline = null;
    const button = document.querySelector('#speakButton'), audioButton = document.querySelector('#audioButton');
    probe.stop = () => { clearInterval(probe.timer); probe.timer = null; probe.active = false; button.removeEventListener('click', probe.activate, true); audioButton.removeEventListener('click', probe.cancel, true); };
    probe.read = () => {
      const state = window.roachSynth.getState();
      return { at: performance.now(), envelope: state.audio.speechEnvelope, amount: state.speechMotion,
        head: state.bones.find(bone => bone.jointId === 'head').quaternion,
        peak: state.audio.peak, time: state.time, playing: state.playing, soundPlaying: state.soundPlaying,
        renderedFrames: state.audio.renderedFrames, audioOn: state.audioOn };
    };
    probe.cancel = () => { probe.action = { ...probe.read(), type: 'audio-off' }; };
    if (action === 'audio-off') audioButton.addEventListener('click', probe.cancel, { capture: true, once: true });
    probe.tick = (source = 'timer') => {
      const frame = { ...probe.read(), source }, now = frame.at;
      probe.frames.push(frame);
      if (frame.envelope > .001 && frame.amount > .001) probe.startedAt ??= now;
      if (frame.envelope > .0001 && frame.amount > .001) probe.firstVoicedAt ??= now;
      const voiced = probe.frames.filter(frame => frame.envelope > .0001 && frame.amount > .001);
      // Apply the synthetic visibility event at a real voiced instant. Audio
      // Off is recorded by its capture listener when the real button is clicked.
      if (action === 'hide' && probe.startedAt !== null && !probe.action && voiced.length >= 3
        && new Set(voiced.map(frame => frame.head.join(','))).size > 1) {
        probe.action = { ...frame, type: action };
        try {
          if (action === 'hide') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
        } catch (error) { probe.actionError = error.message; }
      }
      if (now >= deadline || probe.frames.length >= 600) probe.stop();
    };
    probe.activate = () => { probe.active = true; deadline = performance.now() + 30000; probe.tick('click'); probe.timer = setInterval(probe.tick, 55); };
    window.__roachSpeechProbe = probe;
    button.addEventListener('click', probe.activate, { capture: true, once: true });
  }, action);
}
async function say(page, phrase, touch = false, action = null) {
  await page.locator('#phrase').fill(phrase); await observeSpeech(page, action); await press(page, '#speakButton', touch);
}
async function speaking(page) {
  await page.waitForFunction(() => window.__roachSpeechProbe?.startedAt !== null, undefined, { timeout: 15000 });
}
async function sampleSpeech(page, duration = 900) {
  await page.waitForFunction(duration => {
    const probe = window.__roachSpeechProbe;
    return probe?.startedAt !== null && performance.now() - probe.startedAt >= duration;
  }, duration, { timeout: 20000 });
  return page.evaluate(duration => {
    const probe = window.__roachSpeechProbe;
    return probe.frames.filter(frame => frame.at >= probe.firstVoicedAt && frame.at <= probe.startedAt + duration);
  }, duration);
}
async function quietVoice(page) {
  return page.evaluate(async () => {
    const deadline = performance.now() + 20000; let quietSince = null;
    while (performance.now() < deadline) {
      const now = performance.now(), state = window.roachSynth.getState();
      if (state.audio.speechEnvelope < .0001) quietSince ??= now; else quietSince = null;
      if (quietSince !== null && now - quietSince >= 500) return state.audio.renderedFrames;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    throw new Error('The spoken phrase did not become quiet');
  });
}
async function restored(page, before) {
  await quietVoice(page);
  await expect.poll(async () => (await snapshot(page)).speechMotion, { timeout: 20000 }).toBe(0);
  await expect.poll(async () => quaternions(await snapshot(page))).toEqual(quaternions(before));
  await page.waitForTimeout(350);
  const after = await snapshot(page);
  expect(after.audio.speechEnvelope).toBeLessThan(.0001);
  expect(quaternions(after)).toEqual(quaternions(before));
  expect(offsets(after)).toEqual(offsets(before)); expect(after.camera).toEqual(before.camera);
  expect(players(after)).toEqual(players(before));
  return after;
}
function expectTalking(frames, before) {
  const voiced = frames.filter(frame => frame.envelope > .0001 && frame.amount > .001);
  expect(voiced.length).toBeGreaterThanOrEqual(2);
  expect(voiced.some(frame => JSON.stringify(frame.head) !== JSON.stringify(head(before)))).toBe(true);
  expect(new Set(voiced.map(frame => frame.head.map(value => value.toFixed(7)).join(','))).size).toBeGreaterThan(1);
  expect(frames.every(frame => Number.isFinite(frame.peak) && frame.peak < 1)).toBe(true);
  expect(Math.max(...frames.map(frame => frame.peak))).toBeGreaterThan(.0001);
}

for (const device of [{ name: 'desktop', viewport: { width: 1440, height: 900 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true }]) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, isMobile: device.touch, hasTouch: device.touch });
    test('Say it moves the head with both players off and naturally restores the underlying pose', async ({ page }, testInfo) => {
      const errors = [], workers = [], nativeRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('worker', worker => workers.push(worker.url()));
      page.context().on('request', request => { if (/vendor\/espeak-ng\//.test(request.url())) nativeRequests.push(request.url()); });
      await open(page);
      if (!device.touch) {
        await page.locator('#dragAxis').selectOption('x');
        const point = await page.evaluate(() => window.roachSynth.getPartScreenPosition('head'));
        expect(point).not.toBeNull(); await page.mouse.move(point.x, point.y); await page.mouse.down();
        await page.mouse.move(point.x + 12, point.y - 8, { steps: 3 }); await page.mouse.up();
        expect(offsets(await snapshot(page)).some(bone => Object.values(bone.offset).some(value => value !== 0))).toBe(true);
      }
      const before = await snapshot(page);
      if (!device.touch) await page.screenshot({ path: testInfo.outputPath('face-before-speech.png') });
      await say(page, 'hello little robot bug, hello little robot bug', device.touch);
      await page.waitForTimeout(250);
      expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
      expect(quaternions(await snapshot(page))).toEqual(quaternions(before));
      await arm(page, device.touch); await say(page, 'hello little robot bug, hello little robot bug', device.touch); await speaking(page);
      const frames = await sampleSpeech(page); expectTalking(frames, before);
      expect(workers.some(url => new URL(url).pathname.endsWith('/roach-synth-speech-worker.js'))).toBe(true);
      expect(nativeRequests.some(url => /espeak-ng\/.*\.wasm(?:[?#]|$)/.test(url))).toBe(true);
      expect(frames.every(frame => !frame.playing && !frame.soundPlaying && frame.time === before.time)).toBe(true);
      const after = await restored(page, before);
      expect(after.audio.renderedFrames).toBeGreaterThan(1000); expect(after.sound).toEqual(before.sound);
      await testInfo.attach('speech-head-frames.json', { body: JSON.stringify({ frames, before: head(before), after: head(after) }), contentType: 'application/json' });
      expect(errors).toEqual([]);
    });
  });
}

test('Audio Off clears an active speech gesture and preserves the saved body pose', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await arm(page);
  const before = await snapshot(page); await say(page, longPhrase, false, 'audio-off'); await speaking(page);
  await page.waitForFunction(() => {
    const voiced = __roachSpeechProbe.frames.filter(frame => frame.envelope > .0001 && frame.amount > .001);
    return voiced.length >= 3 && new Set(voiced.map(frame => frame.head.join(','))).size > 1;
  }, undefined, { timeout: 15000 });
  await press(page, '#audioButton');
  const proof = await page.evaluate(() => ({ action: __roachSpeechProbe.action, error: __roachSpeechProbe.actionError, frames: __roachSpeechProbe.frames }));
  expect(proof.error).toBeNull(); expect(proof.action.type).toBe('audio-off');
  expect(proof.action.audioOn).toBe(true); expect(proof.action.envelope).toBeGreaterThan(.0001);
  expectTalking(proof.frames, before); expect((await snapshot(page)).audioOn).toBe(false);
  const after = await restored(page, before);
  expect(after.audio.peak).toBeLessThan(.0001); expect(players(after)).toEqual({ animation: false, sound: false });
  await arm(page); await page.waitForTimeout(350);
  expect((await snapshot(page)).speechMotion).toBe(0); expect(quaternions(await snapshot(page))).toEqual(quaternions(before));
  expect(errors).toEqual([]);
});

test('a second real Say it replaces pending native rendering and the first worker cannot replay', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let release, requested, firstWorker, firstClosed = false, held = false;
  const gate = new Promise(resolve => { release = resolve; });
  const firstRequest = new Promise(resolve => { requested = resolve; });
  page.on('worker', worker => {
    if (!firstWorker && new URL(worker.url()).pathname.endsWith('/roach-synth-speech-worker.js')) {
      firstWorker = worker; worker.on('close', () => { firstClosed = true; });
    }
  });
  await page.route('**/vendor/espeak-ng/*.wasm', async route => {
    if (!held) { held = true; requested(); await gate; }
    await route.continue().catch(() => {});
  });
  try {
    await open(page); await arm(page); const before = await snapshot(page);
    await say(page, longPhrase); await firstRequest;
    expect((await snapshot(page)).audio.speechEnvelope).toBe(0);
    expect(quaternions(await snapshot(page))).toEqual(quaternions(before));
    await say(page, 'hello little robot bug, hello little robot bug');
    await speaking(page); const frames = await sampleSpeech(page); expectTalking(frames, before);
    await expect.poll(() => firstClosed).toBe(true);
    release(); await restored(page, before);
    await page.waitForTimeout(500);
    const after = await snapshot(page);
    expect(after.audio.speechEnvelope).toBeLessThan(.0001); expect(after.speechMotion).toBe(0);
    expect(players(after)).toEqual(players(before)); expect(quaternions(after)).toEqual(quaternions(before));
    expect(errors).toEqual([]);
  } finally { release(); }
});

test('phone speech gestures layer over manual Animation without replacing its clock, pose settings or camera', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await arm(page);
  await page.locator('#motionPreset').selectOption('side_walk'); await press(page, '#motionButton');
  const before = await snapshot(page); expect(players(before)).toEqual({ animation: true, sound: false });
  await say(page, longPhrase); await speaking(page);
  const frames = await sampleSpeech(page, 1500); expectTalking(frames, before);
  expect(frames.every(frame => frame.playing && !frame.soundPlaying)).toBe(true);
  expect(frames.at(-1).time).toBeGreaterThan(frames[0].time + .5);
  await quietVoice(page);
  await expect.poll(async () => (await snapshot(page)).speechMotion, { timeout: 20000 }).toBe(0);
  const after = await snapshot(page);
  expect(players(after)).toEqual(players(before)); expect(after.time).toBeGreaterThan(before.time + 1);
  expect(after.motionChoice).toBe(before.motionChoice); expect(after.motionSettings).toEqual(before.motionSettings);
  expect(offsets(after)).toEqual(offsets(before)); expect(after.camera).toEqual(before.camera);
  await page.waitForTimeout(200); expect((await snapshot(page)).time).toBeGreaterThan(after.time);
  await testInfo.attach('speech-with-animation.json', { body: JSON.stringify(frames), contentType: 'application/json' });
  expect(errors).toEqual([]);
});


// Same deterministic visibility-event pattern as the Enveloper and Yoyodyne suites.
test('a phrase that finishes while hidden does not replay head motion when the page returns', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page); await arm(page);
  const before = await snapshot(page); await say(page, 'hello little robot bug', false, 'hide'); await speaking(page);
  await page.waitForFunction(() => window.__roachSpeechProbe.action !== null, undefined, { timeout: 20000 });
  const proof = await page.evaluate(() => ({ action: __roachSpeechProbe.action, error: __roachSpeechProbe.actionError, frames: __roachSpeechProbe.frames }));
  expect(proof.error).toBeNull(); expect(proof.action.type).toBe('hide'); expectTalking(proof.frames, before);
  const speakingFrames = proof.action.renderedFrames;
  const quietFrames = await quietVoice(page); expect(quietFrames - speakingFrames).toBeGreaterThan(10000);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  const returned = await snapshot(page); expect(returned.speechMotion).toBe(0);
  expect(quaternions(returned)).toEqual(quaternions(before)); expect(players(returned)).toEqual(players(before));
  await page.waitForTimeout(250); expect(quaternions(await snapshot(page))).toEqual(quaternions(before));
  expect(errors).toEqual([]);
});
