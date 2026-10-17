import { expect, test } from '@playwright/test';
import { inflateSync } from 'node:zlib';

test.setTimeout(120000);
const state = page => page.evaluate(() => roachSynth.getState());
async function input(page, selector, value) {
  await page.locator(selector).evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function open(page) {
  await page.goto('roach-synth.html');
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
}
const kept = snapshot => ({ camera: snapshot.camera, view: snapshot.view, side: snapshot.side,
  sound: snapshot.sound, bodyMix: snapshot.bodyMix, muted: snapshot.muted, solo: snapshot.solo,
  playing: snapshot.playing, soundPlaying: snapshot.soundPlaying, audioOn: snapshot.audioOn });

test('animation menu, Next and dice only change motion, with primary Play leaving Drone off', async ({ page }) => {
  await open(page);
  await page.locator('#soundPreset').selectOption('wing-radio');
  await input(page, '#level', .41); await input(page, '#voice', .29);
  await input(page, '#mix-legs', .38); await page.locator('[data-mute="covers"]').click();
  await page.locator('#sideToggle').click();
  await page.locator('[data-view="face"]').click(); await page.locator('#zoomIn').click();
  expect((await state(page)).playing).toBe(false); expect((await state(page)).soundPlaying).toBe(false);
  for (const playing of [false, true]) {
    if (playing) await page.locator('#motionButton').click();
    const before = await state(page);
    for (const id of ['pose:high_kick', 'pose:salute', 'pose:house_monster', 'top_flight']) {
      await page.locator('#motionPreset').selectOption(id);
      const after = await state(page);
      expect(after.motionChoice).toBe(id); expect(kept(after)).toEqual(kept(before));
    }
    await page.locator('#nextMotion').click();
    expect((await state(page)).motionChoice).not.toBe('top_flight'); expect(kept(await state(page))).toEqual(kept(before));
    await page.locator('#randomMotion').click();
    expect((await state(page)).motionChoice).toBe('random'); expect(kept(await state(page))).toEqual(kept(before));
  }
  expect((await state(page)).audio.contextState).toBe('uninitialized');
});

test('focused sound dropdown, Next and dice preserve live levels, camera and motion', async ({ page }) => {
  await open(page); await page.locator('#motionPreset').selectOption('pose:wings_half');
  await page.locator('#motionButton').click(); await page.locator('[data-view="top"]').click();
  await input(page, '#level', .37); await input(page, '#voice', .26);
  const before = await state(page);
  const retained = snapshot => ({ camera: snapshot.camera, motion: snapshot.motionSettings,
    motionChoice: snapshot.motionChoice, playing: snapshot.playing, soundPlaying: snapshot.soundPlaying,
    level: snapshot.sound.level, voice: snapshot.sound.voice, audioOn: snapshot.audioOn });
  await page.locator('#soundPreset').selectOption('wing-radio');
  const chosen = await state(page); expect(retained(chosen)).toEqual(retained(before));
  await page.locator('#nextSound').click(); const next = await state(page);
  expect(next.soundPreset).not.toBe(chosen.soundPreset); expect(retained(next)).toEqual(retained(before));
  await page.locator('#randomSound').click(); const random = await state(page);
  expect(random.soundPreset).toBe('custom'); expect(random.sound).not.toEqual(next.sound);
  expect(retained(random)).toEqual(retained(before));
});

test('complete scene recall preserves custom keyboard framing and always starts animation', async ({ page }) => {
  await page.route('**/src/instruments/roach-synth/roach-synth-app.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'presetController = registerHeaderPresets({';
    expect(source.split(marker)).toHaveLength(2);
    await route.fulfill({ response, body: source.replace(marker, 'presetController = window.__roachPresetQA = registerHeaderPresets({') });
  });
  await open(page);
  const canvas = page.locator('#roachCanvas');
  await canvas.press('ArrowRight'); await canvas.press('+');
  await page.locator('#phrase').fill('Look at my six little feet.');
  const saved = await page.evaluate(() => __roachPresetQA.capture());
  expect(saved.camera).toEqual((await state(page)).camera); expect(saved.playing).toBe(false);
  await page.locator('[data-view="top"]').click(); await page.locator('.header-preset-next').click();
  await input(page, '#level', .43); await input(page, '#voice', .31);
  await page.evaluate(saved => __roachPresetQA.apply(saved), saved);
  const recalled = await state(page);
  for (const field of ['position', 'quaternion', 'target']) {
    recalled.camera[field].forEach((value, index) => expect(value).toBeCloseTo(saved.camera[field][index], 12));
  }
  expect(recalled.camera.distance).toBe(saved.camera.distance); expect(recalled.camera.viewPreset).toBe(saved.camera.viewPreset);
  expect(recalled.view).toBe(saved.view); expect(recalled.side).toBe(saved.side);
  expect(recalled.playing).toBe(true); expect(recalled.soundPlaying).toBe(false); expect(recalled.audioOn).toBe(false);
  expect(recalled.motionSettings.antennae).toBe(true);
  expect(recalled.sound.level).toBe(.43); expect(recalled.sound.voice).toBe(.31);
  await expect(page.locator('#phrase')).toHaveValue(saved.phrase);
  await canvas.press('Home');
  expect(await page.evaluate(() => __roachPresetQA.capture().camera)).toBeNull();
});

for (const device of [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'portrait phone', width: 390, height: 844, touch: true },
  { name: 'landscape phone', width: 844, height: 390, touch: true },
]) test(`${device.name} contains the preset popup while controls scroll and puts values below circular knobs`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, isMobile: device.touch, hasTouch: device.touch });
  try {
    const page = await context.newPage(); await page.goto(new URL('roach-synth.html', baseURL).href);
    await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
    const stage = await page.locator('#specimenViewport').boundingBox();
    const panel = page.locator('.roach-panel'), trigger = page.locator('.header-preset-picker summary');
    const popup = page.locator('#header-preset-panel');
    await trigger.click(); await expect(popup).toBeVisible();
    const checkBounds = async () => {
      const bounds = await panel.boundingBox(), menu = await popup.boundingBox();
      expect(menu.x).toBeGreaterThanOrEqual(bounds.x - 1); expect(menu.y).toBeGreaterThanOrEqual(bounds.y - 1);
      expect(menu.x + menu.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(menu.y + menu.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
      expect(await page.locator('#specimenViewport').boundingBox()).toEqual(stage);
      expect(await page.evaluate(() => scrollY)).toBe(0);
    };
    await checkBounds();
    await page.locator('#header-preset-panel .instrument-picker-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await checkBounds();
    await panel.evaluate(element => { element.scrollTop = 180; }); await page.waitForTimeout(100); await checkBounds();
    await page.screenshot({ path: testInfo.outputPath('preset-menu-contained.png') });
    await page.keyboard.press('Escape'); await expect(popup).toBeHidden();
    const knobs = await page.locator('.roach-knob').evaluateAll(elements => elements.map(element => {
      const face = element.querySelector('.knob-face').getBoundingClientRect();
      const value = element.querySelector(':scope > output').getBoundingClientRect();
      return { for: element.htmlFor, width: face.width, height: face.height, bottom: face.bottom, valueTop: value.top };
    }));
    expect(knobs).toHaveLength(17);
    for (const knob of knobs) {
      expect(knob.width, knob.for).toBe(knob.height); expect(knob.valueTop, knob.for).toBeGreaterThanOrEqual(knob.bottom);
    }
    if (device.touch) {
      const play = await page.locator('#motionButton').boundingBox(); expect(play.width).toBe(48); expect(play.height).toBe(48);
    }
    expect(await panel.evaluate(element => element.lastElementChild.matches('.roach-midi'))).toBe(true);
    await page.locator('#midiPanic').scrollIntoViewIfNeeded();
    const midi = await page.locator('#midiPanic').boundingBox(), bounds = await panel.boundingBox();
    expect(midi.y).toBeGreaterThanOrEqual(bounds.y); expect(midi.y + midi.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
    expect(await page.locator('#specimenViewport').boundingBox()).toEqual(stage);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(device.width);
  } finally { await context.close(); }
});

// Playwright screenshots preserve the actual compositor pixels. Decode their
// PNG filters to inspect the stage corners without relying on a cleared WebGL
// drawing buffer or adding a production render diagnostic.
function pngPixels(buffer) {
  let width, height, channels, offset = 8; const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; expect(data[8]).toBe(8); }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, channels, pixels };
}

test('all camera views fill the stage edges with the floor or matching horizon', async ({ page }, testInfo) => {
  await open(page);
  const reports = [];
  for (const view of ['side', 'top', 'bottom', 'face']) {
    const renderCount = (await state(page)).renderCount;
    await page.locator(`[data-view="${view}"]`).click();
    await expect.poll(async () => (await state(page)).renderCount).toBeGreaterThan(renderCount);
    const screenshot = await page.locator('#roachCanvas').screenshot();
    await testInfo.attach(`floor-${view}.png`, { body: screenshot, contentType: 'image/png' });
    const { width, height, channels, pixels } = pngPixels(screenshot);
    const corners = [];
    for (const [left, top] of [[0, 0], [width - 16, 0], [0, height - 16], [width - 16, height - 16]]) {
      let dark = 0;
      for (let y = top; y < top + 16; y++) for (let x = left; x < left + 16; x++) {
        const offset = (y * width + x) * channels;
        if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 60) dark++;
      }
      corners.push(dark / 256);
    }
    expect(corners.every(fraction => fraction < .25), `${view}: dark stage corner fractions ${corners}`).toBe(true);
    const current = await state(page); expect(current.ground.size).toBeGreaterThan(100); expect(current.camera.viewPreset).toBe(view);
    reports.push({ view, corners });
  }
  await testInfo.attach('floor-edge-pixels.json', { body: JSON.stringify(reports), contentType: 'application/json' });
});
