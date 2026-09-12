import { expect, test } from '@playwright/test';

test.setTimeout(90000);
const snapshot = page => page.evaluate(() => window.roachSynth.getState());
const quaternions = state => state.bones.map(bone => [bone.id, ...bone.quaternion]);
const offsets = state => state.bones.map(bone => ({ id: bone.id, offset: bone.offset }));
const head = state => state.bones.find(bone => bone.jointId === 'head').quaternion;
const players = state => ({ animation: state.playing, sound: state.soundPlaying });
const longPhrase = 'hello little cockroach, I live in your house and I have a very long story to tell you';

async function open(page) {
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
  expect((await snapshot(page)).bones).toHaveLength(31);
  await page.locator('[data-view="face"]').click();
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
async function say(page, phrase, touch = false) {
  await page.locator('#phrase').fill(phrase); await press(page, '#speakButton', touch);
}
async function speaking(page) {
  await page.waitForFunction(() => {
    const state = window.roachSynth.getState();
    return state.audio.speechEnvelope > .001 && state.speechMotion > .001;
  }, undefined, { timeout: 15000 });
}
async function sampleSpeech(page, duration = 900) {
  return page.evaluate(async duration => {
    const frames = [], end = performance.now() + duration;
    while (performance.now() < end) {
      const state = window.roachSynth.getState();
      frames.push({ envelope: state.audio.speechEnvelope, amount: state.speechMotion,
        head: state.bones.find(bone => bone.jointId === 'head').quaternion,
        peak: state.audio.peak, time: state.time, playing: state.playing, soundPlaying: state.soundPlaying });
      await new Promise(resolve => setTimeout(resolve, 55));
    }
    return frames;
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
      const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
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
      if (!device.touch) await page.screenshot({ path: testInfo.outputPath('face-speaking.png') });
      const frames = await sampleSpeech(page); expectTalking(frames, before);
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
  const before = await snapshot(page); await say(page, longPhrase); await speaking(page);
  await expect.poll(async () => head(await snapshot(page))).not.toEqual(head(before));
  await press(page, '#audioButton'); expect((await snapshot(page)).audioOn).toBe(false);
  const after = await restored(page, before);
  expect(after.audio.peak).toBeLessThan(.0001); expect(players(after)).toEqual({ animation: false, sound: false });
  await arm(page); await page.waitForTimeout(350);
  expect((await snapshot(page)).speechMotion).toBe(0); expect(quaternions(await snapshot(page))).toEqual(quaternions(before));
  expect(errors).toEqual([]);
});

test('speech gestures layer over manual Animation without replacing its clock, pose settings or camera', async ({ page }, testInfo) => {
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
  const before = await snapshot(page); await say(page, 'hello little robot bug'); await speaking(page);
  const speakingFrames = (await snapshot(page)).audio.renderedFrames;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const quietFrames = await quietVoice(page); expect(quietFrames - speakingFrames).toBeGreaterThan(10000);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  const returned = await snapshot(page); expect(returned.speechMotion).toBe(0);
  expect(quaternions(returned)).toEqual(quaternions(before)); expect(players(returned)).toEqual(players(before));
  await page.waitForTimeout(250); expect(quaternions(await snapshot(page))).toEqual(quaternions(before));
  expect(errors).toEqual([]);
});
