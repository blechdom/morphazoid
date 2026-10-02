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
async function choose(page, id, value) {
  const trigger = page.locator(`#${id}-picker-trigger`);
  if (await trigger.count()) {
    await trigger.click();
    await page.locator(`#${id}-picker-panel [data-value="${value}"]`).click();
  } else await page.locator(`#${id}`).selectOption(value);
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
        await page.mouse.move(point.x, point.y - 12, { steps: 3 }); await page.mouse.up();
        expect((await snapshot(page)).bones.find(bone => bone.jointId === 'head').offset.x).toBeLessThan(-1);
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
  await choose(page, 'motionPreset', 'side_walk'); await press(page, '#motionButton');
  const before = await snapshot(page); expect(players(before)).toEqual({ animation: true, sound: true });
  await say(page, longPhrase); await speaking(page);
  const frames = await sampleSpeech(page, 1500); expectTalking(frames, before);
  expect(frames.every(frame => frame.playing && frame.soundPlaying)).toBe(true);
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


test('Low KAL16 speaks edited text at a moderate voice level while Play remains held and Audio stays explicit', async ({ page }) => {
  await open(page);
  await expect(page.locator('#voicePreset, #voicePreset-picker-trigger')).toHaveCount(0);
  await expect(page.locator('.roach-voice-name')).toHaveText('Low KAL16');
  await expect(page.locator('#voice')).toHaveValue('0.6');
  await expect(page.locator('#voiceSpeed')).toHaveAttribute('min', '0.5');
  await expect(page.locator('#voiceSpeed')).toHaveAttribute('max', '2');
  await expect(page.locator('#voiceSpeed')).toHaveValue('1');
  const initial = await snapshot(page);
  expect(initial.sound.voicePreset).toBe('flite-kal16-native-4');
  expect(initial.sound.voice).toBe(.6); expect(initial.sound.voiceSpeed).toBe(1);
  await say(page, 'hello little cockroach');
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
  await arm(page);
  const before = await snapshot(page);
  await say(page, 'hello little cockroach'); await speaking(page);
  const active = await snapshot(page);
  expect(active.audio.peak).toBeGreaterThan(.0001);
  expect(players(active)).toEqual({ animation: false, sound: false });
  expect(active.time).toBe(before.time); expect(active.camera).toEqual(before.camera);
  await restored(page, before);
});

for (const running of [false, true]) {
  test(`voice speed changes the sounding buffer's audio-clock duration with Play ${running ? 'running' : 'held'}`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page);
    await page.locator('#voiceSpeed').fill('0.5');
    expect((await snapshot(page)).sound.voiceSpeed).toBe(.5);
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    await page.locator('#voiceSpeed').fill('1'); await arm(page);
    if (running) { await choose(page, 'motionPreset', 'side_walk'); await press(page, '#motionButton'); }
    const before = await snapshot(page);
    // Arm before speech and change both rates in this one browser task. Slow
    // software WebGL can otherwise consume most of a phrase between protocol
    // calls, which makes remaining-duration comparisons meaningless.
    const rateProbe = page.evaluate(async () => {
      const read = () => window.roachSynth.getState();
      const wait = async predicate => {
        const deadline = performance.now() + 15000;
        while (performance.now() < deadline) {
          const state = read();
          if (predicate(state)) return state;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw new Error('Speech did not report the expected audio-clock deadline');
      };
      const setSpeed = speed => {
        const input = document.getElementById('voiceSpeed'); input.value = String(speed);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const normal = await wait(state => state.audio.speechEnvelope > .001 && state.audio.speechUntil > state.audio.audioTime + 2);
      const remaining = state => state.audio.speechUntil - state.audio.audioTime;
      setSpeed(.5);
      const slow = await wait(state => state.sound.voiceSpeed === .5 && state.audio.speechUntil > normal.audio.speechUntil + .5 && remaining(state) > remaining(normal) * 1.25);
      setSpeed(2);
      const fast = await wait(state => state.sound.voiceSpeed === 2 && remaining(state) > 0 && state.audio.speechUntil < slow.audio.speechUntil - .5 && remaining(state) < remaining(slow) * .6);
      return { normal, slow, fast };
    });
    await say(page, `${longPhrase}, ${longPhrase}`);
    const { normal, slow, fast } = await rateProbe;
    const remaining = state => state.audio.speechUntil - state.audio.audioTime;
    expect(slow.sound.voiceSpeed).toBe(.5); expect(remaining(slow)).toBeGreaterThan(remaining(normal) * 1.25);
    expect(fast.sound.voiceSpeed).toBe(2); expect(remaining(fast)).toBeGreaterThan(0);
    expect(remaining(fast)).toBeLessThan(remaining(slow) * .6);
    for (const current of [normal, slow, fast]) {
      expect(players(current)).toEqual(players(before)); expect(current.camera).toEqual(before.camera);
      expect(current.sound.voicePreset).toBe('flite-kal16-native-4');
      expect(Number.isFinite(current.audio.peak) && current.audio.peak < 1).toBe(true);
    }
    expect(Math.max(normal.audio.peak, slow.audio.peak, fast.audio.peak)).toBeGreaterThan(.0001);
    if (running) expect(fast.time).toBeGreaterThan(before.time); else expect(fast.time).toBe(before.time);
    await quietVoice(page);
    await expect.poll(async () => (await snapshot(page)).speechMotion, { timeout: 20000 }).toBe(0);
    const after = await snapshot(page);
    expect(players(after)).toEqual(players(before)); expect(offsets(after)).toEqual(offsets(before)); expect(after.camera).toEqual(before.camera);
    await testInfo.attach('voice-speed-audio-clock.json', { body: JSON.stringify({ running, normal: normal.audio, slow: slow.audio, fast: fast.audio }), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}
