import { test, expect } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

test.setTimeout(90000);
const groups = ['legs', 'covers', 'hindwings', 'thorax', 'abdomen', 'neck', 'head', 'antennae'];
const sources = ['resonance', 'drone', 'sub', 'shimmer', 'buzz', 'zing', 'skuttle', 'walls', 'rustle', 'shriek', 'hiss', 'growl'];
const state = page => page.evaluate(() => window.roachSynth.getState());
async function open(page) {
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
}

test('eight body rows each own a source selector, playable level knob and separate mute/solo', async ({ page }) => {
  await open(page);
  await expect(page.locator('.roach-body-row')).toHaveCount(8);
  expect(await page.locator('.roach-body-row').evaluateAll(rows => rows.map(row => row.dataset.group))).toEqual(groups);
  for (const group of groups) {
    const row = page.locator(`.roach-body-row[data-group="${group}"]`);
    expect(await row.locator('option').evaluateAll(options => options.map(option => option.value))).toEqual(sources);
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
    await page.waitForTimeout(200);
    const horizontal = await knob.boundingBox(), heldScroll = await page.evaluate(() => scrollY);
    await swipe(horizontal.x + horizontal.width / 2, horizontal.y + horizontal.height / 2, -42, 0);
    expect((await state(page)).bodyMix.find(row => row.groupId === 'legs').level)
      .toBeLessThan(before.bodyMix.find(row => row.groupId === 'legs').level);
    expect(await page.evaluate(() => scrollY)).toBe(heldScroll);
    expect((await state(page)).audio.contextState).toBe('uninitialized');
  } finally { await context.close(); }
});

test('source changes, knobs and mute/solo preserve raw levels and do not interrupt either player', async ({ page }, testInfo) => {
  await open(page);
  await page.locator('#source-legs').selectOption('resonance'); await page.locator('#mix-legs').fill('0.63');
  await page.locator('[data-solo="legs"]').click();
  const before = await state(page); expect(before.solo).toEqual(['legs']);
  expect(before.effectiveBodyMix.filter(row => row.groupId !== 'legs').every(row => row.level === 0)).toBe(true);
  expect(before.bodyMix.find(row => row.groupId === 'legs').level).toBe(.63);
  await page.locator('#soundPlayButton').click(); await arm(page);
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
  await page.locator('#motionButton').click(); await page.locator('#resetMix').click();
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
  await page.locator('#soundPlayButton').click(); await arm(page);
  // Skuttle needs movement. Sound Play does not invent footsteps for a held body.
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  await page.locator('#phrase').fill('hi cockroach'); await page.locator('#speakButton').click();
  await expect.poll(async () => (await state(page)).audio.speechEnvelope, { timeout: 12000 }).toBeGreaterThan(.0001);
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  const speaking = await state(page); expect(speaking.solo).toEqual(['legs']); expect(speaking.sound.voice).toBe(voiceLevel);
  expect(speaking.playing).toBe(false);
  await page.locator('#voice').fill('0');
  await expect.poll(async () => (await state(page)).audio.peak).toBeLessThan(.00001);
  expect((await state(page)).bodyMix).toEqual(speaking.bodyMix);
});

test('recorded rustle follows moving legs and releases while a held animation preset stays silent', async ({ page }) => {
  await open(page);
  await page.locator('#source-legs').selectOption('rustle'); await page.locator('[data-solo="legs"]').click();
  await page.locator('#motionPreset').selectOption('side_run'); await page.locator('#soundPlayButton').click(); await arm(page);
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
  expect((await state(page)).soundPlaying).toBe(true);
});

test('Random sound changes complete tone parameters and body assignments while preserving master and transport', async ({ page }) => {
  await open(page); await page.locator('#soundPlayButton').click();
  await page.locator('#level').fill('0.42'); const before = await state(page);
  await page.locator('#randomSound').click(); const first = await state(page);
  for (const key of ['pitch', 'brightness', 'resonance', 'crunch', 'vowel', 'wingRate', 'rhythm', 'pan', 'voice']) expect(first.sound[key]).not.toBe(before.sound[key]);
  expect(first.bodyMix).not.toEqual(before.bodyMix); expect(first.bodyMix).toHaveLength(8);
  expect(first.bodyMix.every(row => sources.includes(row.source) && row.level >= 0 && row.level <= 1)).toBe(true);
  expect(first.sound.level).toBe(.42); expect(first.soundPlaying).toBe(true); expect(first.playing).toBe(false);
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
  await page.locator('#soundPlayButton').click();
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  expect((await state(page)).time).toBe(0);
  await page.locator('#speakButton').click();
  await expect.poll(async () => (await state(page)).audio.speechEnvelope, { timeout: 12000 }).toBeGreaterThan(.0001);
  expect((await state(page)).audioOn).toBe(true);
});
