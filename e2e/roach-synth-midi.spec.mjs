import { expect, test } from '@playwright/test';
import { MIDI_BYTES, enableFakeMidi, fakeMidiSnapshot, installFakeMidi, sendMidi, sendMidiSequence } from './helpers/fake-midi.mjs';

// These exercise the shared toolbar and real AudioWorklet, rather than calling
// the page's MIDI implementation directly. Physical-controller feel is separate.
test.setTimeout(90000);
const state = page => page.evaluate(() => window.roachSynth.getState());
const pageErrors = new WeakMap();
function watchErrors(page) { const errors = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); return errors; }
test.afterEach(async ({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });
const bodyIndex = { legs: 0, covers: 1, hindwings: 2, thorax: 3, abdomen: 4, neck: 5, head: 6, antennae: 7 };
const inputs = [
  { id: 'roach-keys-a', name: 'Roach test keyboard A', manufacturer: 'Morphazoid Tests' },
  { id: 'roach-keys-b', name: 'Roach test keyboard B', manufacturer: 'Morphazoid Tests' },
];
async function open(page, options = {}) {
  watchErrors(page);
  await installFakeMidi(page, options);
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
}
async function enable(page) {
  await enableFakeMidi(page, { timeout: 10000 });
  await expect.poll(async () => (await state(page)).audioOn).toBe(true);
  await expect.poll(async () => (await state(page)).audio.ready).toBe(true);
}
async function silentMidi(page) {
  await expect.poll(async () => (await state(page)).audio.midiActive).toBe(0);
}
async function gate(page, group, active = true) {
  if (active) await expect.poll(async () => (await state(page)).audio.midiGates?.[bodyIndex[group]] ?? 0).toBeGreaterThan(.001);
  else await expect.poll(async () => (await state(page)).audio.midiGates?.[bodyIndex[group]] ?? 1).toBeLessThan(.0001);
}
async function chooseRoute(page, index, value) {
  await page.locator('#midiRoutes').evaluate(element => { element.open = true; });
  const select = page.locator(`#midiRoute${index}`);
  await select.selectOption(value);
}
function quaternion(snapshot, jointId) { return snapshot.bones.find(joint => joint.jointId === jointId)?.quaternion; }
function players(snapshot) { return { sound: snapshot.soundPlaying, animation: snapshot.playing }; }

test('MIDI exposes eight editable routes without requesting permission or arming Audio', async ({ page }) => {
  await open(page);
  await expect(page.locator('#midiKeyMap dt')).toHaveCount(12);
  await expect(page.locator('#midiPanic')).toBeVisible();
  const panic = await page.locator('#midiPanic').boundingBox();
  expect(panic.height).toBeGreaterThanOrEqual(26); expect(panic.height).toBeLessThanOrEqual(28);
  await page.locator('#midiRoutes').evaluate(element => { element.open = true; });
  const defaults = ['param:intensity', 'param:brightness', 'param:resonance', 'param:crunch', 'joint:covers:y', 'joint:hindwings:y', 'joint:head:x', 'joint:antennae:y'];
  for (let index = 0; index < 8; index += 1) {
    const route = page.locator(`#midiRoute${index}`);
    await expect(route).toHaveValue(defaults[index]);
    expect(await route.locator('option').count()).toBeGreaterThan(30);
  }
  await chooseRoute(page, 0, 'joint:head:x');
  const snapshot = await state(page);
  expect(snapshot.audio.contextState).toBe('uninitialized'); expect(players(snapshot)).toEqual({ sound: false, animation: false });
  expect((await fakeMidiSnapshot(page)).requests).toEqual([]);
});

test('body notes animate the head and produce velocity-sensitive sound without starting either player', async ({ page }, testInfo) => {
  await open(page); await page.screenshot({ path: testInfo.outputPath('desktop-midi-collapsed.png'), fullPage: true });
  await enable(page);
  await page.locator('#source-head').selectOption('sine'); await page.locator('[data-solo="head"]').click();
  const before = await state(page);
  await page.evaluate(() => { window.roachMidiEvents = []; addEventListener('morphazoid:midi-input', event => roachMidiEvents.push({ type: event.detail.message.type, cancelled: event.defaultPrevented })); });
  await sendMidi(page, MIDI_BYTES.noteOn(69, 32)); await gate(page, 'head');
  await expect.poll(async () => quaternion(await state(page), 'head')).not.toEqual(quaternion(before, 'head'));
  await page.waitForTimeout(300); const quiet = await state(page);
  expect(quiet.audio.midiNotes[bodyIndex.head]).toBe(69); expect(quiet.audio.midiFrequencies[bodyIndex.head]).toBeCloseTo(440, 2);
  expect(players(quiet)).toEqual({ sound: false, animation: false }); expect(quiet.sound).toEqual(before.sound);
  await page.waitForTimeout(350);
  const heldPose = quaternion(await state(page), 'head');
  expect(Math.max(...heldPose.map((value, index) => Math.abs(value - quaternion(quiet, 'head')[index])))).toBeLessThan(1e-8);
  // MIDI_BYTES.noteOn deliberately excludes zero: send the raw release form.
  await sendMidi(page, [0x90, 69, 0]); await silentMidi(page);
  await sendMidi(page, MIDI_BYTES.noteOn(69, 112)); await gate(page, 'head'); await page.waitForTimeout(300);
  const loud = await state(page);
  expect(loud.audio.midiGates[bodyIndex.head]).toBeGreaterThan(quiet.audio.midiGates[bodyIndex.head] * 1.5);
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  expect(await page.evaluate(() => roachMidiEvents.filter(event => event.type === 'noteOn').every(event => event.cancelled))).toBe(true);
  const stalled = await page.evaluate(async () => {
    const before = window.roachSynth.getState().audio; const end = performance.now() + 700;
    while (performance.now() < end) {}
    // Let queued worklet reports arrive; do not wait for another animation cycle.
    await new Promise(resolve => setTimeout(resolve, 100));
    return { before, after: window.roachSynth.getState().audio };
  });
  expect(stalled.after.renderedFrames - stalled.before.renderedFrames).toBeGreaterThan(16000);
  expect(Number.isFinite(stalled.after.peak)).toBe(true); expect(stalled.after.peak).toBeGreaterThan(.001);
  expect(stalled.after.peak).toBeLessThan(1); expect(stalled.after.midiGates[bodyIndex.head]).toBeGreaterThan(.001);
  await testInfo.attach('midi-audio-during-ui-stall.json', { body: JSON.stringify(stalled), contentType: 'application/json' });
  await sendMidi(page, MIDI_BYTES.noteOff(69)); await silentMidi(page);
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.0001);
});

test('same notes from different inputs and channels release independently, including input disconnect', async ({ page }) => {
  await open(page, { inputs }); await enable(page);
  await sendMidi(page, MIDI_BYTES.noteOn(69, 100, 2), { inputId: inputs[0].id });
  await sendMidi(page, MIDI_BYTES.noteOn(69, 100, 5), { inputId: inputs[1].id }); await gate(page, 'head');
  await sendMidi(page, MIDI_BYTES.noteOff(69, 0, 2), { inputId: inputs[0].id }); await gate(page, 'head');
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  await sendMidi(page, MIDI_BYTES.noteOn(60, 100, 2), { inputId: inputs[0].id }); await gate(page, 'legs');
  // Shared lifecycle panic uses channel zero even for an input's other channels.
  await page.evaluate(id => __morphazoidFakeMidi.disconnectInput(id), inputs[0].id);
  await gate(page, 'legs', false); await gate(page, 'head');
  await sendMidi(page, MIDI_BYTES.noteOff(69, 0, 5), { inputId: inputs[1].id }); await silentMidi(page);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
});

test('sustain, bend and expression stay scoped to the intended channel and retain the raw sound patch', async ({ page }) => {
  await open(page); await enable(page);
  await page.locator('#source-head').selectOption('sine');
  const before = await state(page);
  await sendMidiSequence(page, [
    { data: MIDI_BYTES.controlChange(64, 127, 0) }, { data: MIDI_BYTES.noteOn(69, 100, 0) },
    { data: MIDI_BYTES.noteOn(60, 100, 1) }, { data: MIDI_BYTES.noteOff(69, 0, 0) }, { data: MIDI_BYTES.noteOff(60, 0, 1) },
  ]);
  await gate(page, 'head'); await gate(page, 'legs', false);
  await sendMidi(page, MIDI_BYTES.pitchBend(16383, 1));
  expect((await state(page)).audio.midiFrequencies[bodyIndex.head]).toBeCloseTo(440, 2);
  await sendMidi(page, MIDI_BYTES.pitchBend(16383, 0));
  await expect.poll(async () => (await state(page)).audio.midiFrequencies[bodyIndex.head]).toBeCloseTo(440 * 2 ** (2 / 12), 1);
  await sendMidi(page, MIDI_BYTES.pitchBend(0, 0));
  await expect.poll(async () => (await state(page)).audio.midiFrequencies[bodyIndex.head]).toBeCloseTo(440 * 2 ** (-2 / 12), 1);
  await sendMidi(page, MIDI_BYTES.controlChange(11, 0, 0));
  await expect.poll(async () => (await state(page)).audio.midiExpressions[bodyIndex.head]).toBe(0);
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.0001);
  await sendMidi(page, MIDI_BYTES.controlChange(11, 127, 0)); await gate(page, 'head');
  expect((await state(page)).sound).toEqual(before.sound);
  await sendMidi(page, MIDI_BYTES.controlChange(64, 0, 0)); await silentMidi(page);
});

test('notes across the keyboard hold body poses without transport changes; only explicit MIDI Start and Stop control Animation', async ({ page }) => {
  await open(page); await enable(page); const before = await state(page);
  await sendMidi(page, MIDI_BYTES.noteOn(48)); await gate(page, 'legs');
  await sendMidi(page, MIDI_BYTES.noteOn(69)); await gate(page, 'head');
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
  expect((await state(page)).motionChoice).toBe(before.motionChoice);
  expect((await state(page)).midi.notes.every(note => note.kind === 'body')).toBe(true);
  await sendMidi(page, [0xfa]); await expect.poll(async () => (await state(page)).playing).toBe(true);
  await sendMidi(page, MIDI_BYTES.noteOff(48)); expect((await state(page)).playing).toBe(true);
  await sendMidi(page, [0xfc]); await expect.poll(async () => (await state(page)).playing).toBe(false);
  await page.waitForTimeout(350); expect(players(await state(page))).toEqual({ sound: false, animation: false }); await gate(page, 'head');
  await sendMidi(page, MIDI_BYTES.noteOff(69)); await silentMidi(page);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
});

test('Program Change recalls all sound presets while retaining held body notes and manually started players', async ({ page }) => {
  await open(page); await enable(page);
  await sendMidi(page, MIDI_BYTES.noteOn(48)); await sendMidi(page, MIDI_BYTES.noteOn(60)); await gate(page, 'legs');
  expect((await state(page)).midi.heldCount).toBe(2); expect(players(await state(page))).toEqual({ sound: false, animation: false });
  await page.locator('#soundPlayButton').click(); await page.locator('#motionButton').click();
  const before = await state(page), presets = await page.locator('#soundPreset option').evaluateAll(options => options.map(option => option.value));
  expect(presets).toHaveLength(42);
  for (const program of [0, 17, 18, 41]) {
    await sendMidi(page, [0xc0, program]); await expect(page.locator('#soundPreset')).toHaveValue(presets[program]);
    const after = await state(page); expect(after.motionChoice).toBe(before.motionChoice); expect(players(after)).toEqual(players(before));
    expect(after.time).toBeGreaterThanOrEqual(before.time); expect(after.camera).toEqual(before.camera); expect(after.midi.heldCount).toBe(2);
  }
  await sendMidiSequence(page, [{ data: MIDI_BYTES.noteOff(48) }, { data: MIDI_BYTES.noteOff(60) }]); await silentMidi(page);
  expect(players(await state(page))).toEqual({ sound: true, animation: true });
});

test('CC macro routes control body axes, presets and Voice while standard CCs retain their intended destinations', async ({ page }) => {
  await open(page); await enable(page);
  const before = await state(page);
  await sendMidi(page, MIDI_BYTES.controlChange(15, 127)); expect((await state(page)).sound.brightness).toBeGreaterThan(before.sound.brightness);
  await sendMidi(page, MIDI_BYTES.controlChange(71, 0)); expect((await state(page)).sound.resonance).toBe(0);
  await sendMidi(page, MIDI_BYTES.controlChange(7, 63)); expect((await state(page)).sound.level).toBeCloseTo(.8 * 63 / 127, 2);
  await chooseRoute(page, 0, 'joint:head:x'); const head = quaternion(await state(page), 'head'), sound = (await state(page)).sound;
  await sendMidi(page, MIDI_BYTES.controlChange(14, 127)); await expect.poll(async () => quaternion(await state(page), 'head')).not.toEqual(head);
  expect((await state(page)).sound).toEqual(sound);
  await sendMidi(page, MIDI_BYTES.controlChange(14, 64));
  await expect.poll(async () => Math.abs((await state(page)).midi.controls[bodyIndex.head * 3])).toBeLessThan(.0001);
  await chooseRoute(page, 0, 'select:soundPreset'); const preset = await page.locator('#soundPreset').inputValue();
  await sendMidiSequence(page, [{ data: MIDI_BYTES.controlChange(14, 0) }, { data: MIDI_BYTES.controlChange(14, 127) }]);
  await expect(page.locator('#soundPreset')).not.toHaveValue(preset);
  await chooseRoute(page, 7, 'action:speakButton'); await page.locator('#phrase').fill('hello from MIDI');
  await sendMidiSequence(page, [{ data: MIDI_BYTES.controlChange(21, 0) }, { data: MIDI_BYTES.controlChange(21, 127) }]);
  await expect.poll(async () => (await state(page)).audio.speechEnvelope, { timeout: 15000 }).toBeGreaterThan(.0001);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
});

test('controller-profile logical macros take precedence over conflicting raw standard CC numbers', async ({ page }) => {
  await open(page, { inputs: [{ id: 'minilab', name: 'MiniLab 3', manufacturer: 'Arturia' }] }); await enable(page);
  const before = await state(page);
  // An unmapped MiniLab CC14 must not inherit Generic's macro-zero route.
  await sendMidi(page, MIDI_BYTES.controlChange(14, 0));
  expect((await state(page)).motionSettings.intensity).toBe(before.motionSettings.intensity);
  // MiniLab CC74 is macro zero, whose default route is Movement, not Filter.
  await sendMidi(page, MIDI_BYTES.controlChange(74, 127));
  await expect.poll(async () => (await state(page)).motionSettings.intensity).not.toBe(before.motionSettings.intensity);
  expect((await state(page)).sound.brightness).toBe(before.sound.brightness);
  await page.locator('#midiProfileSelect').evaluate(element => { element.closest('details').open = true; });
  await page.locator('#midiProfileSelect').selectOption('generic');
  await sendMidi(page, MIDI_BYTES.controlChange(15, 127)); expect((await state(page)).sound.brightness).toBe(1);
  await sendMidi(page, MIDI_BYTES.controlChange(74, 0));
  expect((await state(page)).sound.brightness).toBe(0);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
});

test('turning Audio off prevents later MIDI notes from rearming it; MIDI Off and Panic retain manual players', async ({ page }) => {
  await open(page); await enable(page);
  // A held-tone lifecycle check uses a sustained source; percussion intentionally decays after keydown.
  await page.locator('#source-head').selectOption('sine');
  await sendMidi(page, MIDI_BYTES.noteOn(69)); await gate(page, 'head');
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  await page.locator('#audioButton').click(); expect((await state(page)).audioOn).toBe(false);
  expect((await state(page)).midi.heldCount).toBe(1);
  await sendMidi(page, MIDI_BYTES.noteOn(72)); expect((await state(page)).audioOn).toBe(false);
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.0001);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
  await sendMidi(page, MIDI_BYTES.noteOff(72));
  expect((await state(page)).midi.heldCount).toBe(1);
  await page.locator('#audioButton').click(); await gate(page, 'head');
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  await sendMidi(page, MIDI_BYTES.noteOff(69)); await silentMidi(page);
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.0001);
  await page.locator('#soundPlayButton').click(); await page.locator('#motionButton').click();
  await sendMidi(page, MIDI_BYTES.noteOn(69)); await gate(page, 'head');
  await page.locator('#midiPanic').click(); await silentMidi(page); expect(players(await state(page))).toEqual({ sound: true, animation: true });
  await sendMidi(page, MIDI_BYTES.noteOn(69)); await gate(page, 'head');
  await page.locator('#sharedMidiToggle').click(); await silentMidi(page); expect(players(await state(page))).toEqual({ sound: true, animation: true });
  const events = (await state(page)).audio.midiEvents;
  await sendMidi(page, MIDI_BYTES.noteOn(60)); expect((await state(page)).audio.midiEvents).toBe(events);
});

test('computer keys play body notes, leave phrase editing alone and release held notes on blur', async ({ page }) => {
  await open(page); await enable(page);
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.down('z'); await gate(page, 'legs'); expect((await state(page)).playing).toBe(false);
  await page.keyboard.up('z'); await gate(page, 'legs', false);
  await page.keyboard.down('q'); await gate(page, 'legs'); await page.keyboard.down('y'); await gate(page, 'head');
  await page.keyboard.up('q'); await gate(page, 'legs', false); await gate(page, 'head');
  await page.evaluate(() => dispatchEvent(new Event('blur'))); await silentMidi(page); await page.keyboard.up('y');
  await page.locator('#phrase').fill(''); await page.locator('#phrase').pressSequentially('qy');
  await expect(page.locator('#phrase')).toHaveValue('qy'); await silentMidi(page);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
});

test('WAX MIDI events without a routeId reach the exact mapping; unrelated browser routes do not', async ({ page }) => {
  await open(page); await enable(page);
  const dispatch = (source, routeId, type) => page.evaluate(({ source, routeId, type }) => {
    const detail = { source, message: { type, note: 69, velocity: type === 'noteOn' ? 100 : 0, channel: 0, sourceId: 'wax-test', timestamp: performance.now() } };
    if (routeId !== null) detail.routeId = routeId;
    const event = new CustomEvent('morphazoid:midi-input', { detail, cancelable: true }); dispatchEvent(event); return event.defaultPrevented;
  }, { source, routeId, type });
  expect(await dispatch('browser', 'different-instrument', 'noteOn')).toBe(false); await silentMidi(page);
  expect(await dispatch('wax', null, 'noteOn')).toBe(true); await gate(page, 'head');
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
  expect(await dispatch('wax', null, 'noteOff')).toBe(true); await silentMidi(page);
});

test('phone MIDI routes and Panic remain reachable below the sticky specimen', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = watchErrors(page);
  try {
    await installFakeMidi(page); await page.goto(new URL('roach-synth.html', baseURL).href);
    await page.waitForFunction(() => window.roachSynth?.getState().loaded);
    await page.locator('#midiRoutes').evaluate(element => { element.open = true; });
    for (const selector of ['#midiRoute0', '#midiRoute7', '#midiPanic']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox(), stage = await page.locator('#specimenViewport').boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1); expect(box.y + box.height).toBeLessThanOrEqual(845);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(391);
    }
    const panic = await page.locator('#midiPanic').boundingBox();
    expect(panic.height).toBeGreaterThanOrEqual(32); expect(panic.height).toBeLessThanOrEqual(34);
    await page.locator('#midiPanic').tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect((await state(page)).audio.contextState).toBe('uninitialized'); expect((await fakeMidiSnapshot(page)).requests).toEqual([]);
    expect(errors).toEqual([]);
    // Full-page captures can reset Chromium touch emulation; capture only after the input checks.
    await page.screenshot({ path: testInfo.outputPath('phone-midi-routes.png') });
    await page.locator('#midiRoutes').evaluate(element => { element.open = false; });
    await page.screenshot({ path: testInfo.outputPath('phone-midi-collapsed.png') });
  } finally { await context.close(); }
});

test('body notes play before model download and join the loaded pose without starting Animation or replaying released notes', async ({ browser, baseURL }) => {
  for (const released of [false, true]) {
    const context = await browser.newContext(); const page = await context.newPage(), errors = watchErrors(page);
    let releaseModel, requested = false;
    const blocked = new Promise(resolve => { releaseModel = resolve; });
    try {
      await installFakeMidi(page);
      await page.route('**/cockroach-mobile.glb*', async route => { requested = true; await blocked; await route.continue().catch(() => {}); });
      await page.goto(new URL('roach-synth.html', baseURL).href, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => requested).toBe(true); await enable(page);
      expect((await state(page)).loaded).toBe(false);
      await sendMidi(page, MIDI_BYTES.noteOn(69)); await gate(page, 'head');
      await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
      if (released) { await sendMidi(page, MIDI_BYTES.noteOff(69)); await silentMidi(page); }
      releaseModel(); await page.waitForFunction(() => window.roachSynth.getState().loaded, undefined, { timeout: 45000 });
      expect(players(await state(page))).toEqual({ sound: false, animation: false });
      expect((await state(page)).midi.heldCount).toBe(released ? 0 : 1);
      const loadedPose = quaternion(await state(page), 'head');
      if (!released) {
        await gate(page, 'head'); await sendMidi(page, MIDI_BYTES.noteOff(69)); await silentMidi(page);
        await expect.poll(async () => quaternion(await state(page), 'head')).not.toEqual(loadedPose);
      } else {
        await page.waitForTimeout(350); await silentMidi(page); expect(quaternion(await state(page), 'head')).toEqual(loadedPose);
      }
      expect(players(await state(page))).toEqual({ sound: false, animation: false }); expect(errors).toEqual([]);
    } finally { releaseModel(); await context.close(); }
  }
});

test('action macro edges are independent per input and channel, including scoped reset and disconnect', async ({ page }) => {
  await open(page, { inputs }); await enable(page); await chooseRoute(page, 0, 'action:randomSound');
  const before = (await state(page)).sound;
  await page.evaluate(() => { window.roachRandomSoundClicks = 0; document.getElementById('randomSound').addEventListener('click', () => { window.roachRandomSoundClicks += 1; }); });
  const count = () => page.evaluate(() => window.roachRandomSoundClicks);
  const cc = (inputId, channel, controller, value) => sendMidi(page, MIDI_BYTES.controlChange(controller, value, channel), { inputId });
  await cc(inputs[0].id, 0, 14, 127); expect(await count()).toBe(1); expect((await state(page)).sound).not.toEqual(before);
  await cc(inputs[0].id, 0, 14, 127); expect(await count()).toBe(1);
  await cc(inputs[1].id, 4, 14, 127); expect(await count()).toBe(2);
  await cc(inputs[0].id, 3, 14, 127); expect(await count()).toBe(3);
  await cc(inputs[0].id, 0, 121, 0);
  await cc(inputs[1].id, 4, 14, 127); await cc(inputs[0].id, 3, 14, 127); expect(await count()).toBe(3);
  await cc(inputs[0].id, 0, 14, 127); expect(await count()).toBe(4);
  await page.evaluate(id => __morphazoidFakeMidi.disconnectInput(id), inputs[0].id);
  await cc(inputs[1].id, 4, 14, 127); expect(await count()).toBe(4);
  await cc(inputs[1].id, 4, 14, 0); await cc(inputs[1].id, 4, 14, 127); expect(await count()).toBe(5);
  expect(players(await state(page))).toEqual({ sound: false, animation: false });
});
