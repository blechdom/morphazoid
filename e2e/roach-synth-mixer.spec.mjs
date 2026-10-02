import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test.setTimeout(90000);
const groups = ['legs', 'covers', 'hindwings', 'thorax', 'abdomen', 'neck', 'head', 'antennae'];
const sources = ['resonance', 'drone', 'sub', 'shimmer', 'buzz', 'zing', 'skuttle', 'walls', 'rustle', 'shriek', 'hiss', 'growl', 'footsteps', 'fm', 'rattle', 'pluck', 'sine', 'click', 'clack', 'voice-kal'];
const state = page => page.evaluate(() => window.roachSynth.getState());
async function open(page) {
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
}
async function choose(page, id, value) {
  const trigger = page.locator(`#${id}-picker-trigger`);
  if (await trigger.count()) {
    await trigger.click();
    await page.locator(`#${id}-picker-panel [data-value="${value}"]`).click();
  } else await page.locator(`#${id}`).selectOption(value);
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
}
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

test('all ten sound parameters are editable without changing body assignments or arming Audio', async ({ page }) => {
  await open(page);
  const parameters = ['pitch', 'brightness', 'resonance', 'crunch', 'vowel', 'wingRate', 'rhythm', 'pan', 'voice', 'voiceSpeed'];
  expect(await page.locator('[data-sound]').evaluateAll(inputs => inputs.map(input => input.dataset.sound).sort())).toEqual([...parameters].sort());
  const before = await state(page);
  for (const key of parameters) {
    const input = page.locator(`[data-sound="${key}"]`);
    const next = await input.evaluate(element => Math.round((Number(element.min) + (Number(element.max) - Number(element.min)) * .63) / Number(element.step)) * Number(element.step));
    await input.fill(String(next));
    expect((await state(page)).sound[key]).toBe(Number(await input.inputValue()));
  }
  const after = await state(page);
  expect(after.bodyMix).toEqual(before.bodyMix); expect(after.playing).toBe(false); expect(after.soundPlaying).toBe(false);
  expect(after.audio.contextState).toBe('uninitialized'); await expect(page.locator('#soundPreset')).toHaveValue('custom');
});

test('animation and sound choices cycle independently while Next and dice preserve playback and level', async ({ page }) => {
  await open(page);
  expect(await page.locator('#soundPreset optgroup[label="Sound presets"] option').count()).toBeGreaterThanOrEqual(18);
  await expect(page.locator('#soundPreset optgroup[label="Animation sounds"] option')).toHaveCount(24);
  await choose(page, 'soundPreset', 'wing-radio');
  await page.locator('#level').fill('0.43');
  const chosen = await state(page);
  await page.locator('#motionButton').click();
  expect((await state(page)).sound).toEqual(chosen.sound); expect((await state(page)).bodyMix).toEqual(chosen.bodyMix);
  await choose(page, 'motionPreset', 'side_run');
  const running = await state(page);
  expect(running.sound).toEqual(chosen.sound); expect(running.bodyMix).toEqual(chosen.bodyMix);
  await expect(page.locator('#soundPreset')).toHaveValue('wing-radio');
  await page.locator('#nextMotion').click();
  const nextMotion = await state(page);
  expect(nextMotion.motionChoice).not.toBe(running.motionChoice);
  expect(nextMotion.sound).toEqual(chosen.sound); expect(nextMotion.bodyMix).toEqual(chosen.bodyMix);
  await choose(page, 'soundPreset', 'motion:top_flight');
  const flightSound = await state(page);
  expect(flightSound.motionChoice).toBe(nextMotion.motionChoice); expect(flightSound.playing).toBe(true);
  expect(flightSound.bodyMix).not.toEqual(chosen.bodyMix); expect(flightSound.sound.level).toBe(.43);
  await page.locator('#nextSound').click();
  const nextSound = await state(page);
  expect(nextSound.sound).not.toEqual(flightSound.sound);
  expect(nextSound.motionChoice).toBe(nextMotion.motionChoice); expect(nextSound.sound.level).toBe(.43);
  expect(nextSound.playing).toBe(true); expect(nextSound.soundPlaying).toBe(true);
  expect(nextSound.camera).toEqual(chosen.camera); expect(nextSound.audio.contextState).toBe('uninitialized');
  await expect(page.locator('#randomSound svg, #randomMotion svg')).toHaveCount(2);
});

test('metronome controls are removed and muted animation stays silent with antennae active', async ({ page }) => {
  await open(page);
  await expect(page.locator('#metronome, #beatIndicator, #antennae')).toHaveCount(0);
  for (const group of groups) await page.locator(`[data-mute="${group}"]`).click();
  await page.locator('#motionButton').click();
  expect((await state(page)).audio.contextState).toBe('uninitialized');
  expect((await state(page)).motionSettings.antennae).toBe(true);
  await arm(page);
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  const before = (await state(page)).time;
  await page.waitForTimeout(700);
  expect((await state(page)).time).toBeGreaterThan(before + .4);
  expect((await state(page)).playing).toBe(true);
  await expect(page.locator('.roach-invitation')).toHaveCount(0);
});

test('eight body rows each own a source selector, playable level knob and separate mute/solo', async ({ page }) => {
  await open(page);
  await expect(page.locator('#source-legs')).toHaveValue('footsteps');
  await expect(page.locator('.roach-body-row')).toHaveCount(8);
  expect(await page.locator('.roach-body-row').evaluateAll(rows => rows.map(row => row.dataset.group))).toEqual(groups);
  for (const group of groups) {
    const row = page.locator(`.roach-body-row[data-group="${group}"]`);
    expect(await row.locator('option').evaluateAll(options => options.map(option => option.value))).toEqual(expect.arrayContaining(sources));
    await expect(row.locator(`#mix-${group}`)).toHaveAttribute('type', 'range');
    await expect(row.locator('[data-mute]')).toHaveAttribute('aria-pressed', 'false');
    await expect(row.locator('[data-solo]')).toHaveAttribute('aria-pressed', 'false');
  }
  await page.locator('.roach-body-name[data-group="legs"]').click();
  expect((await state(page)).selectedGroup).toBe('legs');
  await page.locator('#mix-legs').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#mix-legs')).toHaveValue('0.01');
  expect((await state(page)).bodyMix.find(row => row.groupId === 'legs').level).toBe(.01);
  expect((await state(page)).audio.contextState).toBe('uninitialized');
});

test('mobile knob vertical drags scroll without changing level; horizontal drags play the knob', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto(new URL('roach-synth.html', baseURL).href);
    await page.waitForFunction(() => window.roachSynth?.getState().loaded);
    const client = await context.newCDPSession(page);
    const swipe = async (x, y, dx, dy) => {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step += 1) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8 }] });
        await page.waitForTimeout(20);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const knob = page.locator('.roach-knob[for="mix-legs"]');
    await knob.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const before = await state(page), start = await knob.boundingBox();
    const scroll = await page.evaluate(() => scrollY);
    await swipe(start.x + start.width / 2, start.y + start.height / 2, 0, -120);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll + 30);
    expect((await state(page)).bodyMix).toEqual(before.bodyMix);
    // Stop native momentum before placing a separate horizontal performance.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 20, y: 800 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await knob.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await settleScroll(page);
    const horizontal = await knob.boundingBox(), heldScroll = await page.evaluate(() => scrollY);
    await swipe(horizontal.x + horizontal.width / 2, horizontal.y + horizontal.height / 2, -42, 0);
    expect((await state(page)).bodyMix.find(row => row.groupId === 'legs').level)
      .toBeLessThan(before.bodyMix.find(row => row.groupId === 'legs').level);
    expect(await page.evaluate(() => scrollY)).toBe(heldScroll);
    expect((await state(page)).audio.contextState).toBe('uninitialized');
  } finally { await context.close(); }
});

test('source changes, knobs and mute/solo preserve raw levels and do not interrupt Play', async ({ page }, testInfo) => {
  await open(page);
  await page.locator('#source-legs').selectOption('resonance'); await page.locator('#mix-legs').fill('0.63');
  await page.locator('[data-solo="legs"]').click();
  const before = await state(page); expect(before.solo).toEqual(['legs']);
  expect(before.effectiveBodyMix.filter(row => row.groupId !== 'legs').every(row => row.level === 0)).toBe(true);
  expect(before.bodyMix.find(row => row.groupId === 'legs').level).toBe(.63);
  await page.locator('#motionButton').click(); await arm(page);
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  await page.locator('[data-mute="legs"]').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  await page.locator('#source-legs').selectOption('drone'); await page.locator('#level').fill('0.7');
  const muted = await state(page);
  expect(muted.bodyMix.find(row => row.groupId === 'legs')).toMatchObject({ source: 'drone', level: .63 });
  expect(muted.effectiveBodyMix.every(row => row.level === 0)).toBe(true);
  expect(muted.muted).toEqual(['legs']); expect(muted.solo).toEqual(['legs']); expect(muted.soundPlaying).toBe(true);
  await page.locator('[data-mute="legs"]').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  await page.locator('[data-solo="thorax"]').click();
  expect((await state(page)).solo).toEqual(['legs', 'thorax']);
  await page.locator('#resetMix').click();
  const reset = await state(page); expect(reset.muted).toEqual([]); expect(reset.solo).toEqual([]);
  expect(reset.sound.level).toBe(.7); expect(reset.playing).toBe(true); expect(reset.soundPlaying).toBe(true);
  const report = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(report.summary.finite).toBe(true); expect(report.summary.clippedSamples).toBe(0);
  await testInfo.attach('roach-body-mix.json', { body: JSON.stringify(report.summary), contentType: 'application/json' });
});

test('body solos leave the independent Voice level and Say it audible', async ({ page }) => {
  await open(page);
  await page.locator('#source-legs').selectOption('skuttle'); await page.locator('[data-solo="legs"]').click();
  const voiceLevel = (await state(page)).sound.voice;
  await arm(page);
  // Skuttle needs movement; a held body does not invent footsteps.
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  await page.locator('#phrase').fill('hi cockroach'); await page.locator('#speakButton').click();
  let speaking;
  await expect.poll(async () => {
    speaking = await state(page);
    return speaking.audio.speechEnvelope > .0001 && speaking.audio.peak > .001;
  }, { timeout: 12000 }).toBe(true);
  expect(speaking.solo).toEqual(['legs']); expect(speaking.sound.voice).toBe(voiceLevel);
  await expect(page.locator('#voiceStatus')).toBeHidden();
  expect(speaking.playing).toBe(false);
  await page.locator('#voice').fill('0');
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  expect((await state(page)).bodyMix).toEqual(speaking.bodyMix);
});

test('recorded rustle follows moving legs and releases while a held animation preset stays silent', async ({ page }) => {
  await open(page);
  await choose(page, 'motionPreset', 'side_run');
  await page.locator('#source-legs').selectOption('rustle'); await page.locator('[data-solo="legs"]').click();
  await arm(page);
  await expect.poll(async () => (await state(page)).audio.samplesLoaded).toBe(3);
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.003);
  const before = await state(page); expect(before.audio.contactEvents).toBeGreaterThan(0);
  await page.locator('[data-mute="legs"]').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  expect((await state(page)).time).toBeGreaterThan(before.time);
  await page.locator('#motionButton').click(); await page.locator('[data-mute="legs"]').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  const stopped = await state(page); await page.waitForTimeout(250);
  expect((await state(page)).audio.contactEvents).toBe(stopped.audio.contactEvents);
  expect((await state(page)).soundPlaying).toBe(false);
});

test('Click and Clack are leg percussion that follows movement and releases when held', async ({ page }, testInfo) => {
  await open(page);
  await choose(page, 'motionPreset', 'side_walk');
  await page.locator('[data-solo="legs"]').click();
  await page.locator('#source-legs').selectOption('click');
  await arm(page);
  const reports = [];
  for (const source of ['click', 'clack']) {
    await page.locator('#source-legs').selectOption(source);
    await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
    expect((await state(page)).bodyMix.find(row => row.groupId === 'legs').source).toBe(source);
    const before = await state(page);
    await page.locator('#motionButton').click();
    await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
    await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(before.audio.contactEvents);
    const report = await sampleAudioEnvelope(page, { durationMs: 650 });
    expect(report.summary.finite).toBe(true); expect(report.summary.clippedSamples).toBe(0);
    reports.push({ source, ...report.summary });
    await page.locator('#motionButton').click();
    await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
    expect((await state(page)).soundPlaying).toBe(false);
  }
  await testInfo.attach('click-clack-motion.json', { body: JSON.stringify(reports), contentType: 'application/json' });
});

test('Random sound changes complete tone parameters and body assignments while preserving master and transport', async ({ page }) => {
  await open(page); await page.locator('#motionButton').click();
  await page.locator('#level').fill('0.42'); const before = await state(page);
  await page.locator('#randomSound').click(); const first = await state(page);
  for (const key of ['pitch', 'brightness', 'resonance', 'crunch', 'vowel', 'wingRate', 'rhythm', 'pan', 'voice']) expect(first.sound[key]).not.toBe(before.sound[key]);
  expect(first.bodyMix).not.toEqual(before.bodyMix); expect(first.bodyMix).toHaveLength(8);
  expect(first.bodyMix.every(row => sources.includes(row.source) && row.level >= 0 && row.level <= 1)).toBe(true);
  expect(first.sound.level).toBe(.42); expect(first.soundPlaying).toBe(true); expect(first.playing).toBe(true);
  expect(first.audio.contextState).toBe('uninitialized');
  await page.locator('#randomSound').click(); const second = await state(page);
  expect(second.sound).not.toEqual(first.sound); expect(second.bodyMix).not.toEqual(first.bodyMix); expect(second.sound.level).toBe(.42);
  await expect(page.locator('#soundPreset')).toHaveValue('custom');
});

test('missing recordings leave smooth synthesis and spoken words playable', async ({ page }) => {
  await page.route('**/assets/roach-synth/audio/*.wav', route => route.fulfill({ status: 503, body: '' }));
  await open(page); await arm(page);
  await expect.poll(async () => (await state(page)).audio.samplesStatus).toBe('unavailable');
  await expect(page.locator('#sampleStatus')).toContainText('unavailable');
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  expect((await state(page)).time).toBeGreaterThan(0);
  await page.locator('#speakButton').click();
  await expect.poll(async () => (await state(page)).audio.speechEnvelope, { timeout: 12000 }).toBeGreaterThan(.0001);
  expect((await state(page)).audioOn).toBe(true);
});


test('sound knobs sit under their preset, keep labels close, and expose values accessibly outside the dial', async ({ page }) => {
  await open(page);
  expect(await page.locator('.roach-tone-controls').evaluate(element => {
    const after = other => Boolean(other.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    const before = other => Boolean(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after(document.getElementById('soundPreset')) && before(document.getElementById('phrase'));
  })).toBe(true);
  for (const knob of await page.locator('.roach-tone-knob').all()) {
    const geometry = await knob.evaluate(element => {
      const box = element.getBoundingClientRect(), face = element.querySelector('.knob-face').getBoundingClientRect();
      const label = element.querySelector('.knob-label').getBoundingClientRect();
      const readout = element.querySelector('small'), style = readout && getComputedStyle(readout);
      return { height: box.height, labelGap: Math.max(0, face.top - label.bottom, label.top - face.bottom), hiddenReadout: !readout || style.display === 'none' || style.visibility === 'hidden' || style.clipPath !== 'none' || style.clip !== 'auto' };
    });
    expect(geometry.height).toBeLessThanOrEqual(52); expect(geometry.labelGap).toBeLessThanOrEqual(6); expect(geometry.hiddenReadout).toBe(true);
    await expect(knob.locator('input')).toHaveAttribute('aria-valuetext', /.+/);
  }
});

test('Low KAL16 body sound is the only voice source and responds to direct joints with Play paused', async ({ page }, testInfo) => {
  await open(page);
  await page.locator('[data-view="face"]').click(); await page.locator('#dragAxis').selectOption('x');
  await page.locator('[data-solo="head"]').click(); await arm(page);
  const reports = [];
  const voiceSources = await page.locator('#source-head option').evaluateAll(options => options.map(option => option.value).filter(id => id.startsWith('voice-')));
  expect(voiceSources).toEqual(['voice-kal']);
  for (const source of voiceSources) {
    await page.locator('#source-head').selectOption(source);
    await expect.poll(async () => (await state(page)).audio.bodyVoicesLoaded, { timeout: 20000 }).toContain(source);
    const before = await state(page);
    const point = await page.evaluate(() => window.roachSynth.getPartScreenPosition('head'));
    expect(point).not.toBeNull();
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(point.x, point.y - step * 2); await page.waitForTimeout(35);
    }
    const active = await state(page);
    expect(active.selectedGroup).toBe('head'); expect(active.audio.interactionPeak).toBeGreaterThan(.001);
    expect(active.playing).toBe(false); expect(active.soundPlaying).toBe(false); expect(active.time).toBe(before.time);
    const report = await sampleAudioEnvelope(page, { durationMs: 250 });
    expect(report.summary.finite).toBe(true); expect(report.summary.clippedSamples).toBe(0);
    reports.push({ source, ...report.summary });
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.0001);
  }
  await testInfo.attach('voicesaurus-body-sounds.json', { body: JSON.stringify(reports), contentType: 'application/json' });
});
