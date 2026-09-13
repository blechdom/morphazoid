import { expect, test } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from './helpers/fake-midi.mjs';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test.setTimeout(90000);
const snapshot = page => page.evaluate(() => window.spiderSynth.getState());
async function loaded(page) {
  await page.waitForFunction(() => window.spiderSynth?.getState().loaded, undefined, { timeout: 45000 });
  expect((await snapshot(page)).bones).toHaveLength(38);
}
async function open(page) { await page.goto('spider-synth.html'); await loaded(page); }
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 }); }
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
}
async function verifyContact(page) {
  const state = await snapshot(page);
  expect(state.frame.supportCount).toBeGreaterThanOrEqual(4);
  expect(state.contactErrors).toHaveLength(8);
  for (const foot of state.footPositions) if (foot.stance) expect(foot.error, foot.id).toBeLessThan(.004);
  return state;
}

test('scan loading cannot block mobile audio, animation or voice controls', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/spider-synth/spider-mobile.glb*', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(new URL('spider-synth.html', baseURL).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.spiderSynth));
    expect((await snapshot(page)).loaded).toBe(false); expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    await page.locator('#soundPlayButton').tap(); await arm(page);
    await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
    await page.locator('#motionButton').tap();
    await expect.poll(async () => (await snapshot(page)).audio.contactEvents).toBeGreaterThan(0);
    expect((await snapshot(page)).loaded).toBe(false);
    await expect(page.locator('#speakButton')).toBeEnabled();
    release(); await loaded(page); expect((await snapshot(page)).playing).toBe(true);
    expect((await snapshot(page)).soundPlaying).toBe(true);
  } finally { release(); await context.close(); }
});

test('detailed scan, complete source bank and view controls expose the new instrument', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const initial = await snapshot(page);
  expect(initial.skin.triangles).toBe(106200); expect(initial.skin.bones).toBe(38);
  expect(initial.audio.contextState).toBe('uninitialized'); expect(initial.view).toBe('top');
  expect(await page.locator('#bodyMixer .spider-body-row').count()).toBe(8);
  expect(await page.locator('#source-legs option').count()).toBeGreaterThan(8);
  expect(await page.locator('#soundPreset option').count()).toBeGreaterThanOrEqual(40);
  expect(await page.locator('#motionPreset option').count()).toBeGreaterThanOrEqual(40);
  await expect(page.locator('#phrase')).toHaveValue("hi, I'm a spider and this is my web");
  await expect(page.locator('.instrument-picker-link[data-tool-id="spider-synth"]')).toHaveAttribute('aria-current', 'page');
  const lighting = initial.lighting;
  for (const view of ['side','top','bottom','face']) {
    await page.locator(`[data-view="${view}"]`).click();
    expect((await snapshot(page)).lighting).toEqual(lighting);
    await page.screenshot({ path: testInfo.outputPath(`spider-${view}.png`) });
  }
  expect(errors).toEqual([]);
});

test('ordinary motion patches keep actual skinned toes supported and vary the body sound assignments', async ({ page }) => {
  await open(page); await page.locator('#motionButton').click();
  const ids = await page.locator('#motionPreset option').evaluateAll(options => options.map(option => option.value));
  const sounds = new Set();
  for (const id of ids) {
    if (['web-jump', 'long-leap', 'tether-bounce', 'rollover'].includes(id)) continue;
    await page.locator('#motionPreset').selectOption(id);
    const start = (await snapshot(page)).time;
    await expect.poll(async () => (await snapshot(page)).frame.time).toBeGreaterThan(start + .15);
    const state = await verifyContact(page); sounds.add(JSON.stringify(state.bodyMix.map(row => row.source)));
    expect(state.audio.contextState).toBe('uninitialized'); expect(state.playing).toBe(true);
  }
  expect(sounds.size).toBeGreaterThanOrEqual(16);
  await page.locator('#motionButton').click(); const time = (await snapshot(page)).time;
  await page.locator('#randomSound').click(); expect((await snapshot(page)).time).toBe(time);
});

test('worklet contacts and bounded audio continue through a main-thread rendering stall', async ({ page }, testInfo) => {
  await open(page); await arm(page); await page.locator('#motionPreset').selectOption('radial-run'); await page.locator('#motionButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.contactEvents).toBeGreaterThan(5);
  const before = (await snapshot(page)).audio;
  await page.evaluate(() => { const end = performance.now() + 450; while (performance.now() < end) Math.sqrt(Math.random()); });
  await expect.poll(async () => (await snapshot(page)).audio.renderedFrames).toBeGreaterThan(before.renderedFrames + 12000);
  const after = (await snapshot(page)).audio; expect(after.contactEvents).toBeGreaterThan(before.contactEvents);
  const envelope = await sampleAudioEnvelope(page, { moduleUrl: new URL('src/audio-output-manager.js', page.url()).href });
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.clippedSamples).toBe(0); expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  await testInfo.attach('audio-stall-and-envelope.json', { body: JSON.stringify({ before, after, envelope }, null, 2), contentType: 'application/json' });
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.activeStrings, { timeout: 15000 }).toBe(0);
  const stopped = (await snapshot(page)).audio.contactEvents;
  await page.locator('#randomSound').click(); expect((await snapshot(page)).playing).toBe(false);
  await expect.poll(async () => (await snapshot(page)).audio.peak, { timeout: 5000 }).toBeLessThan(.0001);
  expect((await snapshot(page)).audio.contactEvents).toBe(stopped);
});

test('computer keys and MIDI hold individual poses while both players stay independent', async ({ page }) => {
  await installFakeMidi(page); await open(page); await enableFakeMidi(page);
  // WAX delegates arming to its DAW host. This suite opens its generated page
  // in an ordinary browser, so explicitly arm that standalone preview.
  if (await page.evaluate(() => Boolean(window.MorphazoidWAX))) await arm(page);
  else await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await page.locator('#spiderCanvas').focus(); await page.keyboard.down('q');
  await expect.poll(async () => (await snapshot(page)).midi.heldCount).toBe(1);
  let state = await snapshot(page); expect(state.playing).toBe(false); expect(state.soundPlaying).toBe(false);
  await expect.poll(async () => (await snapshot(page)).audio.midiEvents).toBeGreaterThan(0);
  await verifyContact(page); await page.keyboard.up('q');
  await expect.poll(async () => (await snapshot(page)).midi.activeCount).toBe(0);
  await page.locator('#motionButton').click(); await sendMidi(page, MIDI_BYTES.noteOn(69, 95));
  await expect.poll(async () => (await snapshot(page)).midi.heldCount).toBe(1); expect((await snapshot(page)).playing).toBe(true);
  await sendMidi(page, MIDI_BYTES.noteOff(69)); await page.locator('#midiPanic').click();
  await expect.poll(async () => (await snapshot(page)).midi.activeCount).toBe(0); expect((await snapshot(page)).playing).toBe(true);
  await page.locator('#motionButton').click(); await page.locator('#phrase').fill('hello web'); await page.locator('#phrase').press('q');
  expect((await snapshot(page)).midi.heldCount).toBe(0);
});

test('spoken words move face controls and release back to the stored pose without starting Animation', async ({ page }) => {
  await open(page); await arm(page); const neutral = (await snapshot(page)).frame.pose;
  await page.locator('#phrase').fill('hello I am a spider'); await page.locator('#speakButton').click();
  await expect.poll(async () => (await snapshot(page)).speechMotion, { timeout: 20000 }).toBeGreaterThan(.03);
  const speaking = await snapshot(page); expect(speaking.playing).toBe(false); expect(speaking.soundPlaying).toBe(false);
  expect(Array.from(speaking.frame.pose).slice(0, 3)).not.toEqual(Array.from(neutral).slice(0, 3));
  await verifyContact(page);
  await expect.poll(async () => (await snapshot(page)).speechMotion, { timeout: 20000 }).toBe(0);
  expect((await snapshot(page)).frame.pose).toEqual(neutral);
});

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`mobile ${size.width}×${size.height} has sticky specimen, reachable Audio and scrolling controls`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true }); const page = await context.newPage();
    try {
      await page.goto(new URL('spider-synth.html', baseURL).href); await loaded(page);
      await expect(page.locator('#soundPlayButton')).toBeEnabled();
      const stage = await page.locator('#specimenViewport').boundingBox(); expect(stage.height).toBeGreaterThan(size.width < size.height ? 300 : 165);
      await page.locator('#source-spirals').scrollIntoViewIfNeeded();
      const scroll = await page.evaluate(() => scrollY); expect(scroll).toBeGreaterThan(100);
      const box = await page.locator('#audioButton').boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
      const camera = (await snapshot(page)).camera; await page.locator('#audioButton').tap();
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
      expect((await snapshot(page)).camera).toEqual(camera); expect(await page.evaluate(() => scrollY)).toBe(scroll);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width + 1);
      await page.screenshot({ path: testInfo.outputPath(`spider-mobile-${size.width}.png`) });
      await page.locator('#soundPlayButton').tap(); await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
      await page.locator('#motionButton').tap(); await expect.poll(async () => (await snapshot(page)).audio.contactEvents).toBeGreaterThan(0);
      await verifyContact(page);
    } finally { await context.close(); }
  });
}

test('web plucking and a trapped fly work independently, then hunting ends its struggle', async ({ page }) => {
  await open(page); await arm(page);
  const point = await page.evaluate(() => {
    for (let id = 200; id < window.spiderSynth.getState().web.segments; id++) {
      const p = window.spiderSynth.getSegmentScreenPosition(id, .5); if (p?.visible) return p;
    }
  });
  expect(point).toBeTruthy(); await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await snapshot(page)).audio.pluckEvents).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).waves.maxDisplacement, { intervals: [50], timeout: 2000 }).toBeGreaterThan(.0001);
  const first = (await snapshot(page)).audio.pluckEvents; await page.locator('#catchBug').click();
  await expect.poll(async () => (await snapshot(page)).audio.pluckEvents).toBeGreaterThan(first + 4);
  await page.locator('#huntBug').click();
  await expect.poll(async () => (await snapshot(page)).world.prey.at(-1)?.state, { timeout: 20000 }).toBe('eaten');
  await expect.poll(async () => (await snapshot(page)).audio.activeStrings, { timeout: 15000 }).toBe(0);
  const state = await snapshot(page); expect(state.playing).toBe(false); expect(state.soundPlaying).toBe(false);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
});

test('failed scan download retains a real preview and retry restores all38 controls', async ({ page }) => {
  let reject = true;
  await page.route('**/assets/spider-synth/spider-mobile.glb*', route => reject ? route.abort('failed') : route.continue());
  await page.goto('spider-synth.html'); await expect(page.locator('#retryModel')).toBeVisible();
  await expect(page.locator('#specimenImage')).toBeVisible();
  expect(await page.locator('#specimenImage').evaluate(image => image.complete && image.naturalWidth > 500)).toBe(true);
  await arm(page); await page.locator('#soundPlayButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
  reject = false; await page.locator('#retryModel').click(); await loaded(page);
  await expect(page.locator('#specimenImage')).toBeHidden(); expect((await snapshot(page)).soundPlaying).toBe(true);
});

test('suspended Audio resumes its frozen beat without jumping through wall time', async ({ page }) => {
  await page.addInitScript(() => {
    const Audio = window.AudioContext;
    window.__spiderAudioContexts = [];
    window.AudioContext = class extends Audio {
      constructor(...args) { super(...args); window.__spiderAudioContexts.push(this); }
    };
  });
  await open(page); await arm(page); await page.locator('#metronome').check();
  await range(page, 'tempo', 120); await page.locator('#motionButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.metronomeEvents).toBeGreaterThan(1);
  await page.evaluate(() => Promise.all(window.__spiderAudioContexts.map(context => context.suspend())));
  const frozen = await page.evaluate(() => ({ time: window.spiderSynth.getState().time, clock: window.__spiderAudioContexts[0].currentTime }));
  await page.waitForTimeout(850);
  expect((await snapshot(page)).time).toBe(frozen.time);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.contextState).toBe('running');
  const { state: resumed, clock } = await page.evaluate(() => ({ state: window.spiderSynth.getState(), clock: window.__spiderAudioContexts[0].currentTime }));
  // Browser automation may itself be delayed by rendering. Only audio-clock
  // advancement may appear in the pose, regardless of that wall-clock delay.
  expect(Math.abs((resumed.time - frozen.time) - (clock - frozen.clock))).toBeLessThan(.05);
  expect(resumed.playing).toBe(true);
  expect(resumed.soundPlaying).toBe(false);
  await expect.poll(async () => (await snapshot(page)).audio.metronomeEvents).toBeGreaterThan(resumed.audio.metronomeEvents);
});

test('dragging the scan plays its selected body sound and keyboard gestures keep zoom independent', async ({ page }) => {
  await page.addInitScript(() => {
    const Worklet = window.AudioWorkletNode;
    window.__spiderGesturePeak = 0;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        this.port.addEventListener('message', ({ data }) => {
          if (data?.type === 'telemetry') window.__spiderGesturePeak = Math.max(window.__spiderGesturePeak, data.peak);
        });
        this.port.start();
      }
    };
  });
  await open(page); await arm(page);
  await page.locator('#source-cephalothorax').selectOption('fm-bell');
  const camera = (await snapshot(page)).camera;
  const point = await page.evaluate(() => window.spiderSynth.getPartScreenPosition('cephalothorax'));
  expect(point?.visible).toBe(true);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 42, point.y - 18, { steps: 18 }); await page.mouse.up();
  // Movement owns finite attacks. Measure during the gesture, before its
  // intentionally short release has expired after mouse-up.
  expect(await page.evaluate(() => window.__spiderGesturePeak)).toBeGreaterThan(.001);
  const moved = await snapshot(page);
  expect(moved.selectedGroup).toBe('cephalothorax');
  expect(moved.motionSettings.offsets.cephalothorax.y).toBeGreaterThan(0);
  expect(moved.playing).toBe(false); expect(moved.soundPlaying).toBe(false);
  expect(moved.camera).toEqual(camera); await verifyContact(page);
  await page.locator('#spiderCanvas').focus(); await page.keyboard.press('ArrowRight');
  const orbited = await snapshot(page); expect(orbited.camera.quaternion).not.toEqual(camera.quaternion);
  expect(orbited.camera.distance).toBe(camera.distance);
  expect(orbited.motionSettings.offsets).toEqual(moved.motionSettings.offsets);
  await page.keyboard.press('Shift+ArrowRight');
  const joint = await snapshot(page); expect(joint.motionSettings.offsets.cephalothorax.y).toBeGreaterThan(moved.motionSettings.offsets.cephalothorax.y);
  expect(joint.camera).toEqual(orbited.camera); await verifyContact(page);
  await page.keyboard.press('+'); expect((await snapshot(page)).camera.distance).toBeLessThan(camera.distance);
  await expect.poll(async () => (await snapshot(page)).audio.peak, { timeout: 10000 }).toBeLessThan(.0001);
});
